# Design effort #157 — kickoff for a fresh session

**Home:** [#157](https://github.com/adrien-mounier/jobcrush-app/issues/157). Read the issue and its
comments first — each design's full record is posted there and on the tickets it binds.

**What this is.** Map #127 made promises and deliberately declined to design the screens that keep
them. This effort designs those screens **before** the build tickets that carry them, as one coherent
pass — so four requirements that are the same control don't become four different controls.

**Format (owner's decision, on #157).** A **live working session**: the owner is in the room, and the
designer shows `/prototype` examples **at each design step** for him to react to. Not a spec thrown
over a wall. It is **not** `ready-for-agent` — it starts when he convenes it.

---

## Where it stands

| Design | Covers | Status | Binding on |
|---|---|---|---|
| **D** — the page with a hole | item 1 | ✅ decided | #159 |
| **A** — confirm & correct | items 3 + 4 | ✅ decided | #161, #163 |
| **B** — "we changed what prints" | item 5 + ADR-0010's three | ⬜ **next** | #168, #170 |
| **C** — the scope of a "no" | items 2 + 6 | ⬜ | #171, #169 |
| **E** — chunked ingestion | the game | ⬜ | #169 |

**Decided so far — read the record, don't re-derive it:**

- **D** → #159's comment. Left-aligned two-line header; the defect was the *centred* header, not the
  missing paragraph. Primary source `apps/web/prototypes/no-summary-layout.prototype.html`.
- **A** → #161's and #163's comments. One dated block = one full card; right confirms, left skips,
  **tap corrects**; panel right; light register. Primary sources
  `apps/web/prototypes/confirm-swipe.prototype.html` (decided) and
  `confirm-and-correct.prototype.html` (three rejected shapes).

---

## Conventions this effort established — follow them

1. **Prototypes are standalone HTML** in `apps/web/prototypes/*.prototype.html`, self-contained, with
   the question and the locked constraints in a header comment, and the **verdict appended** when the
   owner decides. They are the primary source; the issue comment is the summary.
2. **Use the product's real tokens**, never invented ones. `packages/ui/src/tokens.css` for the light
   app; `deck.css` / `discovery.css` `--hud-*` for the dark deck register; `preview.ts`'s inline CSS
   for anything that is a *printed CV*.
3. **Reuse shipped mechanics at their own values.** The swipe deck already exists
   (`apps/web/app/deck/page.tsx` + `deck.css`: 8px activation, axis lock, 90px commit, 110px stamp
   ramp, `jd-out-*`, `jd-dealin`, `jd-bump`), and so does the reward beat (`factbadge.css`'s flying
   gold `.factchip`). **Check for a shipped pattern before designing one.**
4. 🚨 **Designer instrumentation is never on her screen.** Tap counters, budgets, internal vocabulary
   go in the dark prototype chrome. The owner caught this once already — a panel of jargon read as
   customer UI.
5. **Say what a change costs, in plain words, at the moment of the change** — never as a standing
   counter of internal metrics.
6. **A switcher bar** (← → to cycle, keyboard, URL param) so variants are comparable side by side.

## Standing constraints that keep biting

- 🚨 **No standing "always do this" setting.** ADR-0005 and ADR-0007 clause 4 both reject it
  explicitly — it is the leak shape: a choice made for one advert following her onto every later one.
  **The pressure arrives as a usability improvement** (twenty applications, twenty taps), not as a
  disagreement. This is the single most likely thing to be broken by accident in Design B.
- 🚨 **The machine never adds silently, and never removes silently.** Decision 9's own clause and
  ADR-0007 clause 4's mirror.
- **A worked-out value is never asked** (ADR-0008's Mei rule). The tell: *if a rebuild would overwrite
  the answer, the question is aimed one level too high.* This already forced #161's *"is this work?"*
  switch to become *"what is this?"*.
- **Every removal or withholding is declared to `conservationIssues()`, never discovered by it** —
  otherwise a deliberate withholding is byte-identical to the loss the lint exists to catch.
- **Undo everywhere.** #120 is causing live harm on staging: a mistap removes jobs with no undo.
- ✅ **"Showing it is enough"** (owner, this effort): every machine decision must be visible and
  correctable, but **one confirm may cover several**. The ≤15 budget limits **rewording her
  sentences**, not taps.

---

## Design B — the brief

**The question:** the machine changed what prints. How does she see that, and put it back **for this
one application**, in one control rather than four?

**The four requirements that collapse into it:**

1. **"3 more from this role aren't shown."** [#153](https://github.com/adrien-mounier/jobcrush-app/issues/153)
   decided the tailor **chooses** rather than merges when a role has more to say than fits; she is told
   what did not print and may put any back **for that one application**. ADR-0007 clause 4.
2. **"We couldn't place this section."** ADR-0010 clause 9: shown when the LLM sanity gate withholds
   obviously-absurd homeless content, or a never-print-by-default verdict applies. The removal is
   **explained, never silent**.
3. **The one-tap put-back control.** Restores withheld content for **this one application**, verbatim.
   Scope wording matters as much as it does for the decline control (Design C, item 2).
4. **Tidied vs original.** Any beyond-cosmetic correction of homeless content — **translation
   included**, e.g. `Titulaire permis B / Véhiculé` → `Driving licence: B (own vehicle)` — must show
   her original beside the corrected line. She must be able to read it and say *"yes, that's what my
   CV says."*

**Also in scope, from ADR-0007 (#168):** the per-application **withholding pass** — a country
strip-list removing a date of birth, age, marital status, photograph, race, religion or gender. Same
shape: explained, reversible for one application. ⚠️ **A country page is a strip-list, never a market
style guide**, and **no page means nothing is stripped**.

**Read before deciding:**
[ADR-0007](adr/0007-what-prints-is-decided-per-application.md) (all eleven clauses),
[ADR-0010](adr/0010-what-we-cannot-classify-is-kept-printed-and-reviewed-by-kind.md) (clause 9 is the
one that hands work here), #153, and `docs/research/market-strip-lists.md` for what actually gets
stripped in our four markets (they barely differ — three strip all seven).

**⚠️ Constraint on item 1:** it may be **prototyped** but must not be **built** before
[#158](https://github.com/adrien-mounier/jobcrush-app/issues/158) lands claim-ids on printed bullets.
Without them the system cannot name which bullets were left out, and *choosing* silently becomes the
removal ADR-0007 clause 4 forbids.

**⚠️ The trap:** ADR-0007 clause 11 says the **stretch is deliberately NOT unified with this**.
[#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) asked that *must-not-print* and
*prints-only-here* be one mechanism and the answer was **no** — ADR-0005 put a stretch *beside* the
profile so there is nothing to filter, and a shared withholding pass re-introduces the check it
dissolved. **Design B covers withholding; it does not cover stretches.** Those are Design C.

---

## Designs C and E — one line each, so they aren't forgotten

- **C — the scope of a "no."** The stretch **decline** control (ADR-0005 clause 9: a decline states its
  scope — this advert, or never) plus the **profile mute list** (ADR-0011 clause 4: a visible,
  one-tap-reversible list of questions she asked us to stop asking; *"stop asking" may not ship
  anywhere before this surface exists*). ⚠️ Owner's own objection, recorded on #157: *"'never suggest
  this again' is not good enough for the user to understand"* — **a misread control produces permanent
  declines from people who meant *not today*.**
- **E — chunked ingestion.** Map #127 decision 8: topic-bounded chunks read aloud (*"today let's do
  education"*), quit whenever, saves progressively, reward framing. ADR-0011 clause 3: **no counts
  announced**. ⚠️ This is a **new capability**, not a tuning — today's grill is a one-shot burst of ≤5
  questions with no resumable state.

## Open items, recorded and unscheduled

- The **reserved photo corner** (Design D) — #159 keeps it cheap, builds nothing.
- The **bottom-of-page white band** — a thin CV ends ~2/3 down with or without a summary; our rules set
  no minimum length, so nothing notices. Item 1 was scoped to the smaller of two problems.
- **Where a correction happens later** — the deck answers *fix it now*, not *come back in three
  months*. Recorded on #163; candidate is round 1's career timeline.
- The **per-kind owner alert channel** (Telegram / email / dashboard) — ADR-0010 leaves it to this
  effort to home.

## Suggested skills

`/prototype` (UI branch — several structurally different variants, switcher bar) at each design step.
`/grill-me` if the owner wants a decision stress-tested before it is drawn. `/domain-modeling` only if
a design forces a new ADR. Do **not** run `/to-tickets` — the build tickets already exist (#158–#171);
this effort posts **binding instructions onto them**.

## How to start

1. Read #157 and its comments.
2. Read the ADRs named in the brief above.
3. Confirm with the owner which design is being run, then work it: state the question and the locked
   constraints first (naming what is *not* open is what made Designs D and A fast), then build
   variants, then react.
4. When a design closes: append the verdict to the prototype header, post the binding instruction to
   the tickets it binds, update the register on #157, log it in `session-log.md` and `roadmap.md`, and
   commit **named files only** — `apps/api/prompts/preview-tailor.md`, `apps/api/src/preview.ts` and
   `apps/api/test/preview.test.ts` carry unreviewed #158 work that must not reach staging.
