# Languages, derived from the corpus

_Research for #123 (AC7), parent #86, unblocking the dormant #107 withdrawal engine. Re-derives
language demand the same way #106 derived the five eligibility dimensions
(`docs/research/eligibility-dimensions-from-the-corpus.md`) — same corpus, same read-the-full-prose
method, same habit of stating a discrepancy rather than smoothing it. This doc supersedes nothing in
#106's dimension table; it drills into one dimension (`language`) that table already counted at 2/17
and goes one level deeper: which language, at what strength, and across which markets._

## Method

Every advert in `apps/api/data/sample-postings.json` was read in full. As of this derivation
(2026-08-03) the file holds **exactly 17 records**, all real and dated — confirmed by direct count
(`node -e "console.log(require('./apps/api/data/sample-postings.json').length)"` → `17`), not
assumed from #106's doc. #106 warned that the file grew to 23 with synthetic fixtures added by a
later ticket; those fixtures are not present in the file today, so the denominator for this
derivation is the full file, unfiltered — 17 records, 17 read, 0 excluded. Nothing in
`sample-postings.json` mentions any language other than English anywhere (verified by grep for
Mandarin/Cantonese/Vietnamese/Japanese/Korean/bilingual/multilingual/native-speaker/普通话/粤语,
case-insensitive, zero hits) — this is not a sampling gap in my reading, it is the full text of every
posting.

A language demand was counted as **mandatory** when the advert's own text lists it under a
required/needed-to-succeed heading with no hedge, and as **preference** when the text itself hedges
("an advantage", "preferred", "a plus", "nice to have"). I also grepped the corpus directly for that
hedging vocabulary (`advantage|preferred|nice.to.have|bonus|plus`) to check for any preference-level
language mention I might have missed on a first read: it returns exactly two hits, neither about
language — a "Preferred Qualifications" section header (Synpulse) and "Adelaide preferred" (luvo
Talent, about office location, not language). No posting anywhere hedges a language requirement.

## Per-language counts (17 postings) — stated plainly, up front

| Language | Mandatory | Preference/advantage | Postings (mandatory) |
|---|---|---|---|
| English | 2 | 0 | Hays, Endava Vietnam |
| Mandarin | 0 | 0 | — |
| Cantonese | 0 | 0 | — |
| Vietnamese | 0 | 0 | — |
| Any other language | 0 | 0 | — |

The mandatory/preference split is the one #107's engine actually cares about: it withdraws only on a
`kind: "blocking"` requirement, and every language mention in this corpus is phrased as required, not
hedged — so if the ad-reader classifies either of these two as blocking, the split is 2 mandatory / 0
preference, full stop. There is no posting in the corpus today an unticked-language answer could ever
correctly keep in the deck via the preference branch, because no preference-level language mention
exists to test that branch against.

## Markets the corpus spans (17 postings)

| Market | Count | Postings |
|---|---|---|
| Hong Kong SAR | 9 | Hays, TransUnion, Computershare Hong Kong, OKX, Synpulse, BNP Paribas (regulatory-reporting), BNP Paribas (senior-project-manager), Charterhouse Partnership \| Asia, Sanderson-iKas Hong Kong |
| Australia | 4 | Schneider Electric, luvo Talent, MRI Software, PwC Australia |
| Vietnam | 2 | Endava Vietnam, Manulife |
| China (Shenzhen) | 1 | Huaxin Tech Shenzhen |
| APAC / remote, unspecified | 1 | Hire Feed |

None of the ticket's own named hunting markets — **Taiwan** — appears in the corpus at all. Hong Kong
and Vietnam do (9 and 2 postings respectively); the visitor's own base, Thailand, appears nowhere
either (expected — a visitor's base isn't where they're job-hunting).

## Evidence, quoted

**English, mandatory (2/17):**
- Hays (Hong Kong): _"Excellent command of English"_ — listed under "What you'll need to succeed."
- Endava Vietnam: _"Excellent English communication skills."_ — listed under "Soft Skills," itself
  under "Qualifications."

**Every other language (0/17):** no posting names Mandarin, Cantonese, Vietnamese, Japanese, Korean,
or any language besides English anywhere in its text — including Huaxin Tech Shenzhen, the one
posting actually written in Chinese for a Shenzhen employer, whose stated requirements are years of
experience and a degree, not a language (silent on language the same way 16 other postings are
silent on work-rights, for the same likely reason: an assumed-native local hire needs no language
line spelled out in the ad).

## Correcting the record — the English-only claim, checked independently

The owner's own rough measurement — that only English is explicitly named across the corpus — **holds
in the strongest terms the evidence supports.** It is not a near-miss or a matter of interpretation:
zero of the 17 real postings names any language other than English, in either a mandatory or
preference framing, and this was checked three ways — a full read of every posting, a grep for the
language names themselves, and a grep for the hedging vocabulary a preference-level mention would use.
All three agree. A language list derived strictly from what the corpus's adverts state therefore
contains **exactly one entry: English** — and since every English mention in the corpus is mandatory,
strength has no bearing here; there is no preference-level entry for any language to weigh against it
either.

This means the ticket's own driving scenario — a visitor working in English and French, hunting
Taiwan/Hong Kong/Vietnam, who should lose a "Mandarin mandatory" job — **cannot fire from a
strictly-measured list.** No posting in this corpus ever states a Mandarin requirement to withdraw
against, and a strictly-measured list would never ask the visitor about Mandarin in the first place.
The scenario is illustrative of the *shape* #107 already builds correctly (confirmed by
`apps/api/test/withdrawal.test.ts`, which exercises exactly this Mandarin case — but as a
**hand-built test fixture**, not a posting drawn from `sample-postings.json`; grep confirms "Mandarin"
appears nowhere in the data file). The gap this ticket has to close is real, but the corpus itself
supplies no evidence a Mandarin question is needed — that need comes from the markets the visitor
hunts in, not from anything an advert says.

## Does a visitor target-location fact exist today?

**No — checked directly, not assumed.** `apps/api/src/withdrawal.ts`'s own header comment states it
plainly: `work-rights` scoping "ALWAYS returns null" because the discovery question is asked
city-scoped in its wording but stored with no visitor-location fact attached, and the same file
spells out the failure this causes (an Australia-based visitor's Australian jobs deleted by a Hong
Kong sponsorship answer) as "exactly the silent-deletion-of-a-winnable-job failure #86 names as the
worst this engine can make." `apps/api/src/eligibilityDiscovery.ts`'s must-fix-7 comment reaches the
identical conclusion from the other direction (a posting's accepted-applicant-locations vs. a
visitor's own location) and removed a seam over it rather than invent the missing fact. Ticket #124
("Where do you want to work?") is open, unassigned to a build, and is explicitly research-and-design,
not built — confirmed via `gh issue view 124`. So: **no target-location fact exists anywhere in this
codebase today**, and this is not a gap I'm inferring — it is stated in-repo in two separate places
and confirmed by the open state of the ticket that would create it.

This matters directly for the list-derivation question below: without a target-location fact, nothing
can scope which languages are relevant to *this* visitor. Any market-grounded list is necessarily a
single global list shown to every visitor, regardless of where they say they're hunting — the same
constraint #106 already hit with the work-rights question, for the same reason.

## Candidate list options

**Option 1 — strictly corpus-measured.** The list is `{English}`, full stop — the only language any
posting in the corpus ever states. **For:** zero invented content; every entry traces to a named
posting exactly like #106's own dimension counts. **Against:** as shown above, this list cannot
represent the ticket's own driving scenario, and more broadly cannot ever produce a Mandarin/
Cantonese/Vietnamese "no" for #107 to act on — the dormant engine stays dormant for every language but
English. **Cost to the visitor of leaving English unticked:** loses every English-mandatory job (2/17
measured, functionally most of the corpus's real audience, since this product's own CV pipeline is
English-medium) — a visitor who genuinely can't work in English is an edge case this product may not
even serve well elsewhere, but the cost is real and severe for that visitor.

**Option 2 — a fixed short list grounded in the markets the corpus spans.** Add the plausible
day-to-day business languages of Hong Kong (Cantonese, and increasingly Mandarin for mainland-linked
finance work), Vietnam (Vietnamese), and China (Mandarin) to English, regardless of whether any advert
states them — reasoning by direct analogy to #106's own work-rights exception: "APAC adverts routinely
stay silent... even where employers plainly do screen on them... silence in advert text is weak
evidence that nobody gates on it." An advert written in English for international sourcing purposes
may simply never bother restating the on-the-ground language a local hire is assumed to already have.
**For:** the only option that can ever ask about Mandarin at all, which is the entire point of this
ticket — without it, #107 stays dormant for every language-withdrawal case except a hypothetical
English one. **Against, stated as strongly as the evidence against option 1:** this is **zero-evidence
extrapolation** — not one of the 17 real postings states Mandarin, Cantonese, or Vietnamese as a
requirement, mandatory or otherwise, so this option asks every visitor about three languages the
measured corpus gives no reason to believe any employer here demands. It is exactly the kind of
"invented policy" #106's own AC5 section warned against and removed a seam over. It also cannot be
personalised per visitor (see above) — an Australia-only job-hunter gets asked about Vietnamese
anyway. **Cost of leaving one of the three unticked:** today, nothing — zero postings in the corpus
would ever withdraw on it, so this is inert exactly the way the current single-English question's own
code comment already admits English-only is "inert" for a second-language visitor. The cost is only
realised once live posting retrieval (#99–101) brings in adverts that actually do state these
languages.

**Option 3 — do both, sequenced by #124.** Ship option 1 now (the only list the evidence supports
unconditionally), and revisit the list the moment #124 lands a target-location fact — at that point a
market-grounded list stops being a global guess and becomes a real per-visitor derivation (ask about
Cantonese/Vietnamese/Mandarin only for a visitor who actually selected Hong Kong/Vietnam/China as a
target). This defers the Mandarin scenario rather than solving it today, which is an honest cost, not
a free option.

## Recommendation

**Option 2** — extend the corpus-measured `{English}` with Hong Kong (Cantonese, Mandarin), Vietnam
(Vietnamese), and China (Mandarin) as a single global list, recorded explicitly as a **deliberate,
owner-approved deviation from strict corpus-measurement**, the same way #106 recorded the work-rights
exception — dated, reasoned, and not silently smoothed into "the corpus supports this." **The single
strongest argument for it:** without it, this ticket cannot do the one thing it exists to do — #107's
withdrawal engine would remain dormant for every language except a hypothetical non-English-speaking
visitor, which is not the scenario that motivated #86 or #107 in the first place. **The single
strongest argument against it, restated plainly:** it is not measured. Zero of the 17 real postings
back it; option 2 is a product judgment about markets, not a finding this corpus can support the way
every other number in this doc is supported, and it should not be dressed up as corpus-derived when
presented back to the team.

## Decision taken (2026-08-03/04, ticket #123) — implemented

Option 2 was taken, exactly as recommended above: the languages question asks about **English,
Mandarin, Cantonese, Vietnamese** — a single global list, not personalised per visitor (no
target-market fact exists yet — see "Does a visitor target-location fact exist today?" above).
Restating the honesty split plainly, one more time, because the code comment on the constant repeats
it too: **advert-stated language demand across the corpus is English only (2/17, mandatory)**; the
three added languages are the owner's market-based judgment, grounded in the corpus's **measured
market mix** (Hong Kong SAR 9, Australia 4, Vietnam 2, China 1 of 17 postings), not in anything any
advert states. They must never be described as corpus-derived.

**Implementation note, added mid-build (owner requirement, 2026-08-04):** the list is not a hardcoded
constant. It is **market-keyed data** — `apps/api/data/languages-by-market.json` maps each market to
the languages its jobs are plausibly worked in (Hong Kong SAR → English, Mandarin, Cantonese;
Australia → English; Vietnam → English, Vietnamese; China → Mandarin, English) — and the question asks
the **deduped union of every market's languages**, in the union's own stable declared order. With
today's four markets that union comes out to exactly the list above, so nothing about the pinned
question contract changed; only its source did. The reason: the owner wants a future market (e.g.
Laos) to be a **data edit** — one more entry in that file — never a code change, and #124 ("Where do
you want to work?", open, unassigned) will eventually need a market → languages lookup to narrow this
question to a visitor's own target market(s); the market-keyed shape makes that a filter over the same
data, not a redesign. #124 itself was not built here — no visitor target-market fact exists yet.

**Why growing the list is safe:** a visitor who answers before a new market/language is added simply
has no stored fact for that language — which reads as unknown, and an unknown never withdraws
(withdrawal.ts's own rule, unchanged). Verified at both the store-contract seam
(`apps/api/test/discovery.test.ts`'s "#123" block) and the HTTP deck seam
(`apps/api/test/cards.test.ts`'s "#123" block, "growing the language list later stays safe").

**The retired "conversational" tier — a second, unmeasured trade, recorded here too (code review,
2026-08-04):** the pre-#123 single-English question had three options (professional / conversational /
none); this question is a **binary** multi-select (tick / unticked-implies-none), because that is
option (a) as the owner sanctioned it. A binary question structurally cannot write "conversational"
any more — nothing here removes that value from the store's vocabulary (`withdrawal.ts`'s
`isExplicitNo` still honours it for any fact recorded before this change, or by a future surface that
reintroduces a three-way answer), but no live path writes it going forward. This is an accepted cost
of option (a) over (b) (per-language yes/no/some, more questions, more honest at the individual-fluency
level), not a finding — recorded here so it isn't mistaken for an oversight. **Its real risk:** the
question's own bar, *"Tick every one you could run a meeting in,"* reads as excluding a visitor with
real-but-imperfect conversational fluency; not ticking records an explicit "none," which #107 reads as
a genuine no and withdraws every posting that mandates that language — #86's own worst-case failure,
reached from an honest, careful answer. **Mitigation:** the consequence line carries an added sentence
telling an unsure visitor to tick anyway, because ticking can only ever keep a job in the deck, never
remove one — see the constant's own comment in `apps/api/src/eligibilityDiscovery.ts` for the exact
wording and the "add, never soften the pinned sentence" rule it follows.
