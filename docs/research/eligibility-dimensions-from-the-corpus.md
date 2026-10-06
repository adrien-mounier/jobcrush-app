# Eligibility dimensions, derived from the corpus

_Research for #106 (storage: #86 decisions 4+5 / `apps/api/src/eligibility.ts`, already merged). This
re-derives the question set from the corpus rather than reusing a prior, uncited measurement — the
numbers below differ from it in three of five dimensions; the discrepancy is explained, not smoothed
over. Owner-reviewed and corrected 2026-08-03 (see "Correcting the record" and the work-rights
decision below)._

## Method

Every advert in `apps/api/data/sample-postings.json` (17 records — the APAC corpus backing the
published `it-project-delivery` family floor, per `docs/research/live-posting-retrieval-contract.md`)
was read in full and checked for an explicit demand in each of the store's five dimensions
(`apps/api/src/eligibility.ts`'s `ELIGIBILITY_DIMENSIONS`): `years-experience`, `work-rights`,
`language`, `certification`, `degree`. "Explicit" means the advert's own text states the demand —
implied expectations (e.g. professional English is assumed but never written) do not count. Several
excerpts are truncated mid-sentence (the fixture caps at ~2,200 characters); a dimension is counted
only against what is actually present in the file, not guessed from the cut-off tail. Read the full
prose of every posting, not a keyword grep — see "Correcting the record" below for exactly why a
naive substring search on this corpus produces two wrong numbers.

**Denominator note, added after this doc's own numbers were current:** `sample-postings.json` now
holds 23 records, not 17 — a separate session added 6 synthetic test fixtures to that file for a
different ticket, after this measurement was taken. This doc's 17 is, and remains, the count of REAL
corpus adverts as of 2026-08-03, deliberately excluding those synthetic fixtures (they were never
read for this derivation and carry no independent evidence). A future reader who counts 23 in the file
should not conclude this doc undercounted — re-derive against the 17 real, dated postings named in the
Evidence section below, not the file's current total row count.

## Per-dimension counts (17 postings) — stated plainly, up front

| Dimension | Count | Postings |
|---|---|---|
| `years-experience` | 6 | Hays, Endava, Hire Feed, Synpulse, Charterhouse, Huaxin Tech |
| `degree` | 4 | Hire Feed, Synpulse, MRI Software, Huaxin Tech |
| `language` | 2 | Hays, Endava |
| `certification` | 1 | MRI Software |
| **`work-rights`** | **0** | **— zero of 17. No posting states a right-to-work, visa-sponsorship, or citizenship requirement anywhere in its text, full stop.** |

## Correcting the record

The ticket this doc supports cites a prior measurement of 5 years / 3 degree / 2 work-auth / 1
language / 1 certification over 16 adverts. Re-derivation (17 records now, one more than 16) differs
on three dimensions — years (6 vs 5), degree (4 vs 3), and work-rights (0 vs 2). The first two are
explained by the corpus having grown by one record since the prior count. **The work-rights
discrepancy is not a corpus-growth artifact — it is a false positive in the prior measurement, and it
is worth recording precisely so a future reader re-deriving this doesn't reproduce the same mistake
and "fix" this set back to the wrong number.**

**The "2 work authorisation" does not reproduce.** A naive keyword search for `sponsor` matches text
in exactly two postings:

- BNP Paribas (Senior Project Manager, Hong Kong, 2026-07-13): _"The key interactions are with **the
  project sponsor**, front-office teams, operations teams, IT and Finance"_ (and, earlier in the same
  posting: _"Confirm the sponsorship"_, part of a project-framing checklist).
- Manulife (Senior IT Project Manager / Delivery Manager, Vietnam): _"Provides effective and regular
  communication within the project team, **stakeholders, sponsors**, and management"_.

Both are the **project-sponsor** sense — an executive stakeholder who backs the initiative — not visa
sponsorship. Neither posting states an immigration or right-to-work requirement anywhere in its text.
A search that stops at the keyword and does not read the surrounding sentence will overcount this
dimension by exactly this trap; this doc's count (0) comes from reading full context, not a keyword
hit.

**The language count survives the same check, with its own trap noted for the same reason.** A naive
search for `fluen` (meant to catch "fluent"/"fluency") also matches inside **Confluence** — the
Atlassian tool named in more than one posting's tooling list (e.g. TransUnion: _"project management
tools and frameworks, including Jira, **Confluence**, SharePoint"_). That is a false hit for
`language`, not a real one; it does not change the count (2, both explicit "English" mentions — see
Evidence below), but it is recorded here so the next person's regex doesn't repeat it.

## Evidence, quoted

**`years-experience`** (6/17):
- Hays: _"8+ years of operations BA/ PM experience at a top bank"_
- Endava Vietnam: _"8+ years of IT experience, including 5+ years in Project Manager role."_
- Hire Feed: _"Minimum of 3 years of experience in project management"_
- Synpulse: _"At least 6 years of experience in banking and large-scale system implementation project management"_
- Charterhouse Partnership | Asia: _"8+ years' experience as a: Business Analyst Product Mana…"_ (truncated, still explicit)
- Huaxin Tech Shenzhen: _"5年以上IT项目管理经验"_ ("5+ years of IT project management experience")

**`language`** (2/17):
- Hays: _"Excellent command of English"_ (listed under "What you'll need to succeed")
- Endava Vietnam: _"Excellent English communication skills."_ (listed under "Soft Skills" qualifications)

**`degree`** (4/17):
- Hire Feed: _"Bachelor's degree in Business Administration, Project Management, or a related field."_
- Synpulse: _"Bachelor's degree or higher, preferably in finance or Business"_
- MRI Software: _"Bachelor's degree in Business, IT, or related field."_
- Huaxin Tech Shenzhen: _"本科及以上学历，计算机相关专业优先"_ ("Bachelor's degree or above, computer-related major preferred")

**`certification`** (1/17):
- MRI Software: _"Project Management certification (PMP, PRINC…"_ (truncated, clearly PMP/PRINCE2)

**`work-rights`** (0/17): no posting states a right-to-work, visa-sponsorship, or citizenship
requirement anywhere in the file. See "Correcting the record" above for the two near-misses this
count deliberately excludes.

## Decision per dimension

- **`years-experience` — ask.** 6/17, the strongest signal in the corpus, and not asked anywhere else
  in the current discovery flow.
- **`certification` — do not ask here.** #223 retired the old sample floor that asked
  `pm-certification`; credential questions now belong to the production family-floor vocabulary when a
  family needs them, not to this cross-floor eligibility layer.
- **`degree` — do not ask here**, for the identical reason. The corpus count (4/17) can justify a
  future family-floor question, but this eligibility layer remains limited to facts that apply across
  floors or markets.
- **`language` — ask.** 2/17 is the weakest signal kept, but "a dimension nobody asks for is not
  asked" is a zero bar, not a frequency threshold, and GLOSSARY.md's own eligibility-fact examples name
  language fluency explicitly. Both postings that raise it name English specifically, so the one
  question built asks about English, not a generic "your languages" prompt — see the implementation
  note below on the real limitation that choice carries.
- **`work-rights` — ask, as a deliberate, owner-approved exception to this doc's own rule, dated
  2026-08-03.** The measured count is 0/17 (see above — and it is a real zero, not an artifact of the
  `sponsor` false positive). Applied literally, "a dimension nobody asks for is not asked" excludes it.
  The product owner reviewed this exact finding and approved keeping it anyway, for three reasons:
  1. The parent spec (#86, user story 7) promises the user is asked once whether they have the right to
     work somewhere — a commitment made independently of what any single corpus sample happens to state.
  2. Slice 6 (#107) needs a work-rights answer as one of only two grounds on which a job can leave a
     user's deck — the feature has no input to act on if the dimension is never asked.
  3. Substantively: APAC adverts routinely stay silent on visa/right-to-work requirements even where
     employers plainly do screen on them (it is frequently handled off-advert, at application or
     interview stage, rather than stated as a listed requirement). Silence in advert text is therefore
     weak evidence that nobody gates on it — unlike years/degree/certification, which employers
     reliably state in the advert itself when they care about them, work-rights is a case where the
     advert's silence does not mean the employer's indifference.

  This is a genuine, recorded deviation from the corpus-driven rule this doc otherwise follows
  strictly — not a case where the corpus was misread or the rule was quietly reinterpreted.

## Final question set

Three questions: `years-experience` (family-scoped), `work-rights`, `language` (English). Exact
question/option copy is pinned by the UI design spec, not this document — see
`apps/api/src/eligibilityDiscovery.ts`.

## AC5 (provider-stated signal) — deferred, not met

The ticket's AC5 asked for a seam preferring a provider's structured work-eligibility signal
(`applicantLocationRequirements`) to asking the visitor. A first version was built and then removed in
code review (2026-08-03, must-fix 7): its value vocabulary (a canonicalised list of eligible
locations, e.g. `"HK,SG"`) and the vocabulary a user answers into (`eligible` / `needs-sponsorship`, a
status relative to ONE city) are different kinds of fact — "which countries this job accepts
applicants from" does not resolve into "can THIS visitor work in THEIR city without sponsorship"
without also knowing the visitor's own location, which nothing in this codebase collects today.
Coercing the two into one stored value would have been invented policy, not a working seam. This is
real work for #99–#101 (live posting retrieval), once there is an actual visitor-location fact to
compare a posting's requirement against. Reported as deferred to that ticket, not implemented here.

## Implementation notes carried from this derivation

- **Language is a list, not a value, but the store and the pinned single-select copy both hold one.**
  The eligibility store's `EligibilityFact` is keyed `(session, dimension, family)` — a second `put()`
  for `language` overwrites the first rather than adding to it. The one language question this ticket
  builds asks about English only, because that is the only language named anywhere in the corpus, so
  this limitation is inert today. If the product later wants a second language asked, the current store
  cannot hold both answers simultaneously without a shape change — not addressed here, logged as a
  known limit for whoever owns the store next.
- **The years-band lower bound is a deliberate underestimate, not a bug.** Each band resolves to its
  lower bound at the write (`5–7 years` → 5, `More than 10 years` → 10, `Under 3 years` → 0), per the
  pinned UI design spec — never a midpoint. This never overstates what the visitor confirmed; someone
  who picks "Under 3 years" but actually has 2 years reads as having 0 for scoring purposes, which is a
  real precision loss inherent to banding a continuous fact, accepted by the design rather than
  discovered by this implementation.
