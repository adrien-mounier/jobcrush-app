# ADR-0007 — What prints is decided per application, not per fact

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#144](https://github.com/adrien-mounier/jobcrush-app/issues/144) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0001](0001-growth-rule-for-structured-facts.md) (the growth rule), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) (how a fact reaches the page), [ADR-0004](0004-each-elements-own-parts.md) clause 5 (a certification carries its validity), [ADR-0005](0005-a-stretch-belongs-to-its-advert.md) (a stretch belongs to its advert), [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) owner decision 5 (capture the maximum)
- **Amends:** ADR-0001 rule 4 — scope note, not an amendment
- **Fills:** ADR-0002's missing case. That ADR decides *where* a fact lands and assumes throughout that a held fact is a printable fact.
- **Does not decide:** the content of any country page (research, see [Consequences](#consequences)); how a coarse date is written on the page ([#143](https://github.com/adrien-mounier/jobcrush-app/issues/143))

## Context

The map flagged *capture versus render* twice as needing its own ticket. It arrived carrying a legal
driver — Singapore's Workplace Fairness Act, ~end-2027, SGD 50,000 per violation — and a working
assumption that a class of fact exists which we hold but may never print.

**The premise was wrong in the candidate's favour, and the owner corrected it.** Singapore's rules
point at **employers**: they must strip age, date of birth, gender, race, religion, marital status and
photograph from applications, and must not use nationality as a selection criterion. **Nothing stops a
candidate writing any of it on their own document.** No law is broken. A compliant recruiter's process
discards it; a human one reads it as someone who does not know the market.

**So this is not a compliance feature with a deadline. It is a CV-quality feature.** The 2027 date is
when the convention changes, not a date we must ship by. The map's claim that #144 was *"the only
ticket with an external deadline attached"* is withdrawn.

Three facts about the live product framed the decision:

- **We are currently instructed to print nationality and told never to drop it.**
  `prompts/preview-tailor.md` rule 6 — *"Languages, nationality, and similar profile facts render in
  `additional`… Never drop them"* — sits inside the section headed *tailor by emphasis, not
  amputation*. This is not a risk we might create; it is an instruction we already gave.
- **The useful, legal version of the fact already exists separately.** The `work-rights` eligibility
  dimension already asks *"Can you already work in {city} without visa sponsorship?"*, stores the
  answer, and withdraws jobs on it. That is the line a Singapore employer wants. **Nationality is never
  needed to say it.**
- **A photograph cannot print.** `renderPreviewHtml()` has no image slot; the only image in the
  renderer is the draft watermark, and no photo is read off the uploaded document. Of Singapore's
  trio (photo, date of birth, nationality), the photo is inert for us.

## Decision

### 1. There is no unprintable fact. Printing is decided per application

We hold everything [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) decision 5 says to
hold. **No fact is permanently barred from the page.** What exists instead is a **withholding pass that
runs when a CV is built, for one advert**, and can reach a different answer next time.

**This changes render, never capture.** It is the map's working assumption, now decided. Capture in
fact *widens* — see clause 6.

### 2. Print by default; a per-market strip-list may withhold

Each market we serve has a **country page**: a short list of things to strip.

> date of birth · age · marital status · photograph · race · religion · gender

**A strip-list, not a style guide.** Everything not on the list prints. The page names *what to remove*
and nothing else — no CV length, no date format, no section naming, no vocabulary, no tone.

**Rejected explicitly: a market style engine.** Every per-market instruction is another way a tailored
CV regresses in the other three markets, and the CV writer's instruction list already contains two
rules that contradict each other.

### 3. No page means nothing is stripped

An unknown market (`APAC (Remote)`, `London / Singapore`) or a market whose page has not been written
yet: **the pass runs and removes nothing.** Everything prints.

**Taken deliberately, with the cost named:** every unresearched market prints everything. This is
clause 1 applied honestly — the alternative (fall back to a house strip-list) inverts the design, making
the global default *strip* and a country page a permission to keep.

### 4. Nothing is removed silently, and the candidate can put it back

**The mirror of decision 9's own clause.** *The machine never adds silently* has a twin: **the machine
never removes silently.** Every removal is explained where the candidate sees it.

And a removal is **reversible by the candidate, for that one application.** The choice does **not**
follow them to the next advert.

Worked: a Singaporean citizen applying to a role stating *"Singapore citizens preferred"* — lawful and
common for government-linked employers. Our Singapore page strips nationality. He puts it back for that
CV. The next advert starts from the page's answer again.

**Rejected: a standing setting.** *"Show my nationality from now on"* is cheaper for him and it prints on
the adverts where it hurts him — the exact leak shape [ADR-0005](0005-a-stretch-belongs-to-its-advert.md)
was written to prevent.

### 5. A withholding never touches the profile

A fact withheld from one CV is **unchanged in the record**. It stays the person's, permanently, per
`CLAUDE.md`'s reuse rule: a fact they stated, corrected, or that we read from their CV is theirs on any
tailored CV where it helps.

The withholding is a property of **one rendering**, exactly as an approved stretch is a property of one
application.

### 6. The seven are stored facts, not letterhead text

Today a CV's letterhead reaches the CV writer as one lump of text:

> `Remy Tan · 12 Orchard Road, Singapore · +65 9123 4567 · remy@mail.com · Born 4 July 1978 · Married, 2 children · Singaporean`

For a page to drop the last three and keep the first four, **something must know which is which.**
The seven therefore become **recognised, stored, correctable facts** with the full ADR-0004 treatment,
not free text a prompt judges.

**Rejected: let the CV writer judge the text.** It costs nothing to build and nothing is checkable — we
could not prove a strip happened, could not test it, and could not tell *"checked, nothing to strip"*
from *"never ran"*.

**Rejected: close the doors instead** (fix the letterhead to name/city/phone/email, always). Cheapest by
far, and it re-creates the blanket rule clause 1 rejects: no country page could ever choose to print a
birth date, and it shuts only the two doors we currently know about.

### 7. A fact that is printed but never matched ships on four gates, not five

**ADR-0001 rule 4 gains a case, discovered on the route rather than staged.** Run the seven through the
release gate:

| | Stored + correctable | Used in matching | Prints | Contract-validated |
|---|---|---|---|---|
| **nationality** | ✅ | ✅ an advert can test it (*"Singapore citizens preferred"*) — the judged score grades it | ✅ | ✅ |
| **the other six** | ✅ | 🚨 **never, by construction** | ✅ | ✅ |

No advert tests a date of birth or a marital status, and none ever will. They are not **preferences**
either — they narrow nothing, so ADR-0001 rule 5's sorting test still calls them facts. **They exist
only to be printed or withheld.**

> **The clause:** an element whose only consumer is the page ships on **four** readers — stored and
> correctable, prints, contract-validated, **and its country-page behaviour decided**. The matching
> reader is **not waived, it is satisfied by absence being deliberate**: an element claiming this case
> must state that no advert can test it, and that statement is the thing reviewed.

**This is not a fifth attempt at the retired paper stress test.** The route walked into it while
pricing clause 6. Recorded as a scope note on ADR-0001 rule 4, alongside ADR-0006's two.

### 8. The market is resolved when the advert is read, not when the CV is built

The advert's country is worked out **once, at advert read**, and stored on the advert beside its title,
company and requirements.

Three reasons, all of which the tailoring-time alternative loses:

1. **Paid once per advert, not once per CV.** A person tailors against one advert more than once.
2. **The guess becomes visible and correctable** — it can show on the job card, so a human catches
   `London / Singapore` landing on the wrong one.
3. **The cost is already priced.** ADR-0001 rule 6 prices a new dimension on the advert read as a lazy
   re-read of every stored advert. This is a known cost, not a new one.

**Rejected: both** (resolve early, re-check at tailoring) — two answers that can disagree with no rule
for which wins, the two-sources-of-truth failure #128 §4 already ruled out on this map.

### 9. An expired certification prints with its state shown, and the person chooses

[ADR-0004](0004-each-elements-own-parts.md) clause 5 lets us hold that a credential has lapsed. What
reaches the page:

- It **prints, with its state shown** — `PL 300 - Power BI Data Analyst Associate, Feb 2023 (expired)`.
  Nothing hidden, nothing lost, defensible in the room.
- **We tell the person it has lapsed**, and they choose: keep it with the date, **keep it without the
  date**, or drop it.

🚨 **The without-the-date option stands even on the advert that demands that certification** — the case
where it is closest to presenting a lapsed credential as current. **Taken knowingly, and it is the
philosophy, not an oversight:** the product proposes and does not police honesty, the human owns the
choice, and they can defend it because they made it. Adding a guardrail here is precisely what the owner
rejected in decision 9.

**Note what "expired" means and does not mean.** He passed PL-300 in February 2023; that happened and
remains true. What lapsed is Microsoft's continued endorsement. *Expired* is **not vouched for any
longer**, never *untrue*.

### 10. The record says which page answered, and a withholding is declared to the lint

Two mechanical clauses without which this ADR is unfalsifiable:

- **Every rendering records which country page answered, its version, and what it removed.**
  *"Singapore page applied, removed 3 items"* and *"no page for this market, nothing removed"* must not
  produce an identical result. **A check that finds nothing must be distinguishable from one that did
  not run** — the failure mode this project has recorded three times in one month.
- **A withheld fact is declared to `conservationIssues()`, never discovered by it.** That lint exists to
  catch the CV writer silently dropping a class of facts; a deliberate withholding is indistinguishable
  from the loss it was built to catch unless the pass says so up front.

### 11. Each country page carries its own next-check date

Legal ground moves on named dates. Singapore's act commences around end-2027; a calendar-yearly sweep
can miss a commencement by up to twelve months.

**Each page states when it should next be checked**, derived from the commencements it knows about, so
the artifact tells us when to look rather than us remembering.

## What this rule does NOT change

**The approved stretch does not use this mechanism, and the two are deliberately not unified.**
[#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) handed this ticket a suggestion that
*must-not-print* and *prints-only-here* be shaped as one missing concept. **Answered with a no.**
ADR-0005 put a stretch **beside** the profile, attached to its advert — so a later advert's CV writer
has nothing to filter and nothing to fail. Routing it through a withholding pass re-introduces exactly
the check ADR-0005 chose absence over. Two problems, two answers.

**Capture is untouched.** [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) decision 5
stands in full; clause 6 widens it.

**ADR-0002 clause 4 stands.** Where a fact lands on the page (labelled line by default, summary when the
advert tests it) is unchanged. This ADR decides only *whether* it lands.

**ADR-0001 rule 5 is untouched.** The seven are facts, not preferences; clause 7 is a note on rule 4
alone.

## Consequences

**Two live instructions are wrong and must change.**

- `prompts/preview-tailor.md` rule 6 tells the CV writer nationality must **never be dropped**. As a
  *conservation* rule it forbids the withholding pass from ever firing. It must become a **default**
  (print unless a page says otherwise), not a prohibition.
- The same file's *"Certifications are sacred… Never drop, rename, or merge them"* needs clause 9's
  case — a state suffix is not a rename.

**The country pages do not exist and are the gating research.** Four markets, from our posting
provider's coverage: **Hong Kong, Singapore, Vietnam, Australia — zero UK, zero EU.** Per the map's
standing rule each runs twice (deep + `/last30days`). Filed as
[#151](https://github.com/adrien-mounier/jobcrush-app/issues/151).

**The near-term payoff on personal details is roughly one market, and this should be known before
anyone prices the build.** Australia and Hong Kong point the same way as Singapore. **Vietnam is the
only divergence**, and its most distinctive convention is the photograph — which clause 6's context
records as unrenderable. So the strip-lists will largely agree, and the knowledge base's first
genuinely valuable content is likely **regional vocabulary**, already evidenced in our own research
(*"programme manager"* and *"delivery manager"* are near-absent in Hong Kong and Singapore where
*"project manager"* dominates). **That is not this ADR's scope** — clause 2 forbids it — but it is the
reason the artifact is worth its cost, and the reason to expect a follow-on decision.

**Marie in Paris is not a customer.** The French-convention cost used to argue against a blanket rule
does not exist in our served markets. The argument that survives is clause 1's principle, not that
scenario.

**The seven become an element-shaped build.** ADR-0001 rule 4's cost applies, at the per-element price
ADR-0006's scope note established — not the multi-session figure quoted for the rule in general, since
the printing route already exists (ADR-0002 clause 4's labelled line takes anything) and matching is
waived for six of the seven by clause 7.

**Our own gaps stay visible.** Clause 10's record is the only thing that will tell us a country page is
missing rather than empty, and clause 3 guarantees a missing page fails silently on the page itself.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **A fixed product-wide never-print list** (clause 1) | Cheapest and unfailable — no route to the page means nothing can put a birth date there. | The machine deciding, invisibly, that a fact of the person's is unfit to print. Violates the mirror of *never adds silently*, and imposes one market's convention on every market. |
| **Never capture it at all** (clause 1) | Nothing held, nothing to decide at print time. | Overturns *capture the maximum*, loses the fact from the career record permanently, and does not even work — the details ride in the letterhead, so dropping them means recognising them first. |
| **The person decides every time, with no default** (clause 2) | Most honest about whose document it is. | Twenty applications, twenty decisions — the exact tax the product exists to remove — and a tired person ticks *include* on the one where it hurts. |
| **A full per-market style guide** (clause 2) | The knowledge base pays for itself across length, format, vocabulary, tone. | Unbounded content, and every per-market instruction is a new way a tailored CV regresses in the other three markets. |
| **A house strip-list when no page exists** (clause 3) | Safer, and three of our four markets agree with it. | Inverts the design: the global default becomes *strip* and a country page becomes permission to keep — the blanket rule under another name. |
| **Refuse to tailor until a page exists** (clause 3) | Makes the gap impossible to ship past. | Our research gap becomes the candidate's blocked application. |
| **A standing "always show my nationality" setting** (clause 4) | One decision instead of twenty. | It prints on the adverts where it hurts him — the leak shape ADR-0005 exists to prevent. |
| **The advert decides, with no manual control** (clause 4) | No new control, no per-application choice. | Depends entirely on reading the advert right, and adverts state it far less plainly than the worked case does. |
| **Leave the seven as text and let the CV writer judge** (clause 6) | No model change at all; ships immediately. | Nothing checkable: no proof a strip happened, no test, and *"found nothing"* indistinguishable from *"never ran"*. |
| **Model only nationality; keep the other six as text** (clause 6) | Only one element passes the growth rule anyway. | Two mechanisms for one strip-list, and the six with no structure behind them are the six hardest to get right. |
| **Resolve the country inside the tailoring step** (clause 8) | The owner's own first proposal; nothing changes in how adverts are read. | Paid per CV rather than per advert, invisible, uncorrectable, and two CVs for one job can resolve differently. |
| **Withhold an expired certification entirely** (clause 9) | The cleanest-looking CV. | The machine silently removing a real achievement, in every market, with no market rule behind it — and a head-on collision with *certifications are sacred*. |
| **Print an expired certification unchanged** (clause 9) | Today's behaviour; nothing to build. | The person defends a credential they no longer hold, in the room. The failure ADR-0004 clause 5 was written to prevent. |
| **Unify withholding with the approved stretch** (What this rule does NOT change) | One missing concept designed once, as #141 suggested. | Re-introduces the per-advert filter ADR-0005 dissolved by putting a stretch beside the profile. An absence cannot fail; a shared filter can. |

## Verification

**Writing Singapore's country page must be a mechanical walk through this ADR** — a strip-list of the
seven names in clause 2, a next-check date from the Act's commencement, and nothing else. **If it turns
into a fresh argument about what may print, or the page wants a field clause 2 does not have, this ADR
is wrong and #144 reopens.**

Second check, cheaper and earlier: **`prompts/preview-tailor.md` rule 6 must change before any country
page can do anything.** If a build ticket implements the pass and leaves *"never drop them"* in place,
the feature is dead on arrival and clause 10's record is what will say so.
