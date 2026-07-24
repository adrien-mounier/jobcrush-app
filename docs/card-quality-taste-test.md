# Card-quality taste-test — stub scorer (matchtick.ts)

**Issue:** #14 (parent spec #11, onboarding reveal). **Date:** 2026-07-24.
**Question:** before real users hit the reveal, are stub-scored job cards *bad* —
worse-than-a-job-board embarrassing — or merely average (survivable)?

## Verdict: GO, with guardrails (not NO-GO-on-bad)

The cards are **not categorically embarrassing.** The core signal holds — a strong
candidate scores far above an average one, and a weak/off-target CV correctly scores
**0 on 19 of 20 ads**. On the three carefully-authored real ad fixtures the profile is
clean and defensible (strong 88/88/81, average 47/38/0, weak 0/0/0 — no inversions).

But there is a **real embarrassing tail** that surfaces specifically on *natural* ad
text (ads whose requirement wording doesn't happen to share vocabulary with the
candidate's facts). That tail is what a soft launch and a curated first card exist to
contain. See "Bad examples" below — they are genuine and a discerning user would catch
them.

## How this was produced

- **Real scorer, not hand-scored.** A throwaway harness
  (`~/.claude/jobs/3f7bba9b/tmp/tastetest.mjs`) imports the compiled
  `apps/api/dist/matchtick.js` (a pure function — it only *type*-imports contracts, so
  it has zero runtime deps) and calls `matchTick` / `uncoveredRequirements` /
  `pickHitClause` exactly as `test/matchtick.test.ts` does. No repo source or test files
  were touched.
- **Ads (20).** Only **3 distinct ranked ad-requirement sets exist in the repo**
  (`sample-ad-requirements.json`: Manulife, Endava, luvo Talent). Those 3 were used
  as-is. The other **17 were hand-derived from the real posting excerpts** in
  `sample-postings.json` (13 postings) plus **4 deliberate variants** (a vague generic
  ad, a cert/finance-heavy ad, an agile-tooling ad, an exec-comms ad) to stress the
  quality range and reach 20. Bands (must/should/nice) mirror how each posting phrases
  the item. The 17 are *synthetic requirement-ranking over real ad wording* — flagged so
  the reader weights the 3 real ones more heavily.
- **CVs (3),** expressed as the confirmed-fact shape the scorer eats (`{text}` lines,
  mirroring the fixtures/tests):
  - **A — strong, on-target senior IT PM:** budget ownership, cross-functional/vendor
    leadership, SteerCo reporting, end-to-end transformation, risk/RAID, PMP + Delivery
    Manager title, Agile/JIRA. (10 facts)
  - **B — average/partial:** manages timelines, coordinates teams, status updates to
    manager, Asana/Trello, some Agile. No budget, no vendor/SI, no exec/SteerCo, no cert.
    (5 facts)
  - **C — weak/off-target (old/unrelated CV):** office events, customer emails,
    spreadsheets, data entry, a hobby line. (4 facts)

## Score distribution (20 ads each)

| CV | min | median | mean | max |
|---|---|---|---|---|
| A — strong    | 18 | 56 | 58.4 | 100 |
| B — average   | 0  | 27 | 27.6 | 82  |
| C — weak      | 0  | 0  | 1.4  | 27  |

Weak-CV scores: `[0×19, 27]`. The lone 27 is a token coincidence ("data"/"spreadsheets"
brushing OKX's "leverage data") — see OKX below.

## The 60 scores (score = match %; gap = top "don't-yet")

| Ad | A-strong | B-average | C-weak |
|---|---|---|---|
| **Manulife Sr IT PM** *(real)* | **88** | 47 | 0 |
| **Endava Sr PM** *(real)* | **88** | 38 | 0 |
| **luvo Talent Sr PM** *(real)* | **81** | 0 | 0 |
| Schneider Electric Sr PM | 21 | 21 | 0 |
| Hays FO PM/BA | 46 | 0 | 0 |
| TransUnion Sr PM | 50 | **56 ⚠** | 0 |
| Computershare Business Readiness | 50 | 0 | 0 |
| Hire Feed PM (remote) | 100 | 82 | 0 |
| OKX Sr Strategy PM | 27 | 27 | **27 ⚠** |
| Synpulse BA/PM | 93 | 21 | 0 |
| BNP Paribas PM/Lead BA | 43 | 36 | 0 |
| Charterhouse Sr BA/Product | 57 | 36 | 0 |
| MRI Software PM III | 47 | **60 ⚠** | 0 |
| PwC Australia PM | 43 | 21 | 0 |
| Sanderson-iKas BA/Product | 18 | 0 | 0 |
| BNP Paribas Sr PM (DRIVE) | 43 | 36 | 0 |
| Generic PM (vague) | 56 | 22 | 0 |
| Cert-heavy Finance PM | 67 | 0 | 0 |
| Agile-tooling Delivery Lead | 75 | 50 | 0 |
| Exec-comms Transformation PM | 75 | 0 | 0 |

⚠ = an embarrassing pair (see below).

## What's good (the GO evidence)

- **Weak CV is correctly filtered:** 0 on 19/20 ads. The stub does not flatter a bad
  candidate — the opposite of embarrassing.
- **Strong CV tops out where it should:** 88/88/81 on the 3 real ads, 93 (Synpulse),
  100 (Hire Feed), 67–75 on the cert/agile/exec variants. Reads as a believable
  "strong fit."
- **On authored ads the ordering is monotonic** (A > B > C) with a sensible spread —
  exactly the reveal experience the spec wants.

## What's bad (the tail that argues for guardrails)

The scorer is **band-weighted token-union overlap** — it rewards *vocabulary
coincidence between the ad's wording and the candidate's fact wording*, not actual fit.
When an ad phrases requirements in its own natural language (the realistic launch case),
three failure modes appear:

1. **Average beats strong (rank inversion).** MRI Software: strong **47** vs average
   **60**; TransUnion: strong **50** vs average **56**. A genuinely stronger candidate is
   shown a *lower* match % than a weaker one. This is the worst-than-a-job-board case: a
   job board never claims a fit number, so it can't get the ranking backwards. If a
   senior PM sees 47% where a junior would see 60%, the number is actively misleading.
2. **Flat score regardless of quality.** OKX: **27 for strong, average AND weak alike.**
   The card shows everyone the same number — obviously broken to a discerning eye, and it
   even hands the off-target CV a 27%.
3. **Strong candidate undersold on in-target ads.** Sanderson **18**, Schneider **21**,
   OKX **27**, PwC/BNP **43** — all PM/BA roles a strong senior IT PM would genuinely be
   shortlisted for, scored low because the requirement text uses divergent vocabulary
   ("workflow design", "problem statements", "AI-assisted workflows"). The reputational
   risk is the *undersell*: telling a strong applicant they're an 18–27% match for a job
   they'd actually get an interview for.

None of these three appear on the 3 real hand-authored ads — because those fixtures were
written with candidate-shaped vocabulary. **Card quality is entirely a function of
vocabulary alignment between ad text and confirmed facts.** Curated ads look good;
arbitrary natural ads produce the tail.

## Recommendations

### Wall opening position: keep it AT the reveal (the spec default) — but curate the first card

Capturing signup on the *first* card is the right call precisely *because* of the quality
profile. The first card should be a **hand-checked, vocabulary-aligned ad** (like the 3
real fixtures), where the score reads strong and honest. Letting users browse *many* free
cards before the wall (wall-later) only increases the odds they hit an inversion or a
flat-27 and lose trust before you've captured them. Wall-at-reveal on a curated first
card = highest-trust first impression.

### Soft / limited launch: YES, advised

The failure tail is real and will surface the moment arbitrary natural-text ads flow
through the tick. A limited launch with a **curated ad pool** (or at minimum a
hand-verified first card per session) de-risks the reveal while E5 replaces the stub.
Do **not** open a wide launch that lets any scraped ad hit the tick unchecked — that is
where the inversions and flat scores live.

### Cheap stub hardening (optional, if launch predates E5)

- Suppress/flag the number when it can't discriminate (e.g. don't show a % when strong
  and weak would land within a few points — the OKX case), rather than printing a
  confident-but-meaningless 27.
- Floor the weak-CV token bleed by requiring a covered "must" before showing any positive
  score, so an off-target CV can't back into 27% on coincidental words.
- These are stub band-aids, not fixes — the root fix is E5 (JC-31) doing semantic, not
  token, matching.

## Caveats

- **Only 3 distinct ranked ad-requirement sets exist in the repo fixtures.** 17 of the 20
  ads are hand-derived from real posting excerpts (13) plus 4 synthetic variants — weight
  the 3 real ads most. The embarrassing tail lives entirely in the derived/natural-text
  ads, which is *also* the realistic launch condition, so it should not be discounted.
- CVs are representative constructions, not real user data; absolute numbers will shift
  with real fact wording. The *patterns* (correct weak-filtering, vocabulary-driven
  inversions/undersell) are structural to the token-overlap algorithm and will hold.
