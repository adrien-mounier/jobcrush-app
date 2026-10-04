# CV Authoring Rules

Canonical rules for writing or modifying any CV content in this repo. These were extracted from
CLAUDE.md §4 (Output Rules), §6 (Writing Style), and §10 (Quality Checklist) so that the
always-loaded CLAUDE.md stays lean while these rules are enforced on **every** CV edit — including
ad-hoc edits made without invoking `/tailoring` or `/cv-to-docx`.

Enforcement is automatic, not optional:
- A **PreToolUse** hook (`.claude/hooks/cv-rules-inject.mjs`) injects the digest below next to every
  `Edit`/`Write` on a CV file, so these rules are in context the moment a CV is touched.
- A **PostToolUse** hook (`.claude/hooks/cv-lint.mjs`) lints the file after the edit and blocks on
  mechanical violations (forbidden glyphs, run-on skills block, section order).

A "CV file" is any `root_cv/**/*.md`, any `**/tailored_cv/**/*.md`, or any `cv_mounier_*.md`.

<!-- DIGEST:START -->
## Contents

- [Hard rules (auto-injected on every CV edit)](#hard-rules-auto-injected-on-every-cv-edit)
- [Output Rules (full — was CLAUDE.md §4)](#output-rules-full-was-claudemd-4)
  - [ATS compliance](#ats-compliance)
  - [Dates](#dates)
  - [Coarse and unknown dates (decided 2026-08-06, issue #143)](#coarse-and-unknown-dates-decided-2026-08-06-issue-143)
  - [Professional Summary](#professional-summary)
  - [Length and bullet density (decided 2026-08-07, issue #153)](#length-and-bullet-density-decided-2026-08-07-issue-153)
  - [Visual formatting and section design](#visual-formatting-and-section-design)
- [Writing Style (full — was CLAUDE.md §6)](#writing-style-full-was-claudemd-6)
- [Quality Checklist (full — was CLAUDE.md §10)](#quality-checklist-full-was-claudemd-10)

## Hard rules (auto-injected on every CV edit)

- **Length / density — the budget is the page, not the bullet.** 2 pages max, single column. The
  newest role gets **first call** on the page, each older role takes **less than the one before**,
  and **no single role exceeds 10 bullets**. First call is not a floor: a role with 4 good bullets
  prints 4, never 10 padded ones. **A role is one flat bullet list — never split into blocks**
  ("Achievements" / "Key Deliveries" / etc.); a source CV that uses such a heading has all its
  bullets counted together under that role. One to two lines per bullet (three absolute max).
- **When a role has more to say than fits: choose, do not squish.** Print the bullets this advert
  wants, whole, with their outcomes intact; the rest do not print and the candidate is **told which**
  and may put any back **for that one application**. Merge only two bullets that genuinely say the
  same thing — **never as a way to make room**.
- **Forbidden glyphs:** no em-dash (—), en-dash (–), ellipsis (…), pipe (|) outside markdown
  tables, or semicolons as list separators. Use plain commas, full stops, or line breaks.
- **Section order is fixed** (from the root CV): Summary, Professional Experience, Personal
  Projects, Skills, Education, Additional Information. Never move Skills above Professional
  Experience.
- **Skills block:** 2-4 bold-labeled categorized groups (bold category label on its own line, comma
  list on the next line, no blank line between). 8-12 skills total. Never a run-on comma paragraph.
  One skills block only — no duplicate Core Competencies run-on.
- **Bold only:** name, section headings, employer, job title, skills category labels, education
  institutions, additional-info labels. Never bold whole sentences or bullet bodies.
- **Education / Additional Information:** bold the key info. Education: `**Institution - Location**,
  year` then the degree (plain) on the next line. Additional Info: `**Nationality:** value`,
  `**Languages:** ...`, `**Certifications:** ...` (bold label, plain value).
- **No sub-headings inside a role.** A role's bullets are one flat list. Never emit `*Key
  Deliveries*`, `Achievements`, `Project Achievements` or any other label above part of a role's
  bullets (deleted 2026-08-07, issue #155 — see *Length and bullet density*).
- **Dates:** `Month YYYY` or `MM/YYYY`, month-first, and the SAME one of those two forms across the
  whole CV including Education and Certifications. `Present` (capitalised) for a current role.
  Never year-only (`2021 - 2024`), never year-first (`2024/03`), never two-digit years (`'24`),
  never seasons (`Summer 2023`), never `Now` or `Current`. If the source CV states only years,
  keep them exactly. Never infer a month.
- **A role whose end is unknown prints its start alone** (`2003`), keeping its chronological place.
  Never `Present` (that is a lie, not a formatting choice), never `Since 2003` or `From 2003`, and
  never a role with no date line at all.
- **A tailored CV never carries a date prompt.** Missing months are asked once, during ingestion, and
  noted once on the master CV. The tailored CV prints the honest coarse date and says nothing.
- **Summary — prints only when it earns its place.** It prints only if it carries a **concrete
  achievement** (a named thing done, with a result or a number) **or a fact this advert tests**.
  Otherwise the whole section is omitted, **heading included** — never an empty heading. Order:
  achievement first, then context only if it is not already on the page, then the advert's tested
  facts in one short closing clause that never displaces the achievement. **No word count.** Banned:
  the identity opener (`Senior Project Manager with 7+ years of experience...`), capability claims
  (`proven ability to`, `expertise in`, `strong in`, `comfortable bridging`, `results-driven`), and
  restating the title, employer, dates or years already visible elsewhere on the page.
- **Education years print exactly as held**, in every market. No age-proxy stripping.
- **Outcome-led bullets:** action verb + scope + outcome (when the source supports it). No
  responsibility-only or attendance bullets.
- **No invented facts:** never invent dates, employers, titles, certifications, or metrics. Non-
  Verified / non-Derived claims must appear in the verification audit.
- **A denied capability never appears, and is never implied** (#287, 2026-09-27). When the person has
  answered *"No — I have never done this"* about something the advert asks for, the CV prints nothing
  about it **and** says nothing that hands it to a recruiter by implication: not in the Summary, not as
  a skills-group label, not as an adjacent phrase that only reads as that capability. Print the
  adjacent **true** fact on its own merit instead. The denied item's own words must not appear anywhere
  on the page. The gap is **disclosed** to the candidate, never filled
  (`tailoring-reasoning.md` §8).
- **An unticked line never prints** (#335, [ADR-0016](../adr/0016-the-cv-is-reviewed-not-asked.md)
  clause 5). Every CV line is **ticked** (prints) or **kept** (the person unticked it: held in the
  profile under *"kept for when a job needs it"*, never deleted, re-tickable). The master CV, every
  tailored draft and every export are built from ticked lines only — a kept line never reaches the
  tailor's input. Unticking is always the person's tap, never the machine's.
- Full detail, ATS pitfalls, formatting standards, and the banned-word list are below.
<!-- DIGEST:END -->

---

## Output Rules (full — was CLAUDE.md §4)

Every tailored CV must prioritize relevance, concise recruiter-friendly language, and outcomes. No buzzword filler.

**ATS compliance** — read `/research_result/2026-05-03_ats-parsing-pitfalls.md` before any CV write. Hard constraints:
- Single-column layout. No contact info in headers or footers. No pipe `|` separators (use dash or comma).
- Standard fonts (Arial, Calibri, Roboto). Standard bullets (`•` or `-`). Dates per the Dates rule below.
- Conventional section headings ("Work Experience", "Education", "Skills"). DOCX preferred; PDF must be text-based.

**Dates** — full reference: `research/2026-05-03_ats-parsing-pitfalls.md`. Month granularity is not a
style preference; it is what makes a CV parseable and what stops a recruiter reading concealment into
the timeline.

- **Two accepted forms, month-first:** `Month YYYY` (March 2021) or `MM/YYYY` (03/2021). Abbreviated
  month names (`Mar 2021`) are acceptable inside the first form. Pick one form and apply it to every
  role, certification, and education entry. Mixing the two within a document is itself a parse hazard,
  and it is the single most common date defect.
- **`Present`, capitalised,** for a current role. Not `Now`, `Current`, `Today`, or an open-ended dash.
- **Never year-only** (`2021 - 2024`). Recruiters read year-only ranges as gap-concealment whether or
  not a gap exists, and the range still leaves the missing months visible. It also defeats tenure
  calculation and cannot order overlapping roles correctly.
- **Never year-first** (`2024/03`, `2024-03`). No mainstream parser or reader expects that ordering on
  a CV, whatever its merits as a sort key.
- **Never two-digit years** (`'24`) — they break experience calculators — and never seasons
  (`Summer 2023`), which the strictest parsers reject outright.
- **When the source CV states only years, keep them exactly.** Anti-fabrication outranks format
  compliance: a plausible month is still an invented fact. Reformatting is always allowed; supplying
  missing precision never is.

### Coarse and unknown dates (decided 2026-08-06, issue #143)

The rules above say what a date may look like. These say what to do when we do not have one.

**A job whose end we do not know prints its start alone — `2003` — and keeps its chronological
place.** Not `Since 2003`, not `From 2003`, and never `Present`, which is a lie rather than a
formatting choice. Not a dateless entry either: a role with no date line is a documented parsing
hazard. This is [ADR-0003](../adr/0003-the-shared-parts-organisation-date-level.md) clause 6's third
end state — *ended, we do not know when* — reaching the page for the first time.

**That state is the one hole always worth a question**, because a job with an unknown end contributes
**zero** to years of experience: a 22-year career reads as 19, and the missing three are why a
"20+ years" advert never reaches the candidate. Ask it with the reason said out loud — *"this job is
currently counting as zero years towards your total"* — because that is the sentence that makes
someone answer.

**A missing month is asked once, during ingestion, while the candidate is telling us about that job,
and is never chased afterwards.** ADR-0003 clause 5's *do not ask* triggers (a bar turns on it, a gap
might not be one) govern **going back to bother them later**, not the single pass where they are
narrating their history anyway. **Never ask for dates with "roughly is fine"** — that phrasing
manufactures the coarse dates these rules then have to handle.

**When the candidate genuinely does not know**, the master CV carries **one** passive note — *"three
roles are missing months"* — and **the tailored CV carries nothing at all**. Not a prompt on every
tailored CV; not silence either. The tailored CV prints the honest coarse date.

**Education years print exactly as we hold them, in every market.** A graduation year is a legible
age proxy and that is accepted deliberately: the *"graduation years are a strong age proxy"* claim
traces to a vendor blog whose own audit measured something else, and de-identification is not
evidence-backed — Australia's randomised trial found it did not promote diversity. There is no
age-proxy stripping rule and its absence is a decision, not an oversight.

**Professional Summary** — full reference: `docs/research/cv-summary-structure-and-length.md` and its
`last30days-` companion (issue #152). Decided 2026-08-06, issue #143.

> 🚨 **The former `≤ 55 words` cap is deleted.** It had no source anywhere — it existed in the
> tailoring prompt and in [ADR-0002](../adr/0002-how-a-structured-fact-reaches-the-cv.md) quoting that
> prompt, and nothing derived it. **No rival number is sourced either**, including the 60–80 words
> this file's own IT-PM research note asserts. The only peer-reviewed synthesis on CV length has a
> whole section on the subject, one finding (*never exceed two pages*), and **no row for the
> summary**. SEEK, which owns the job board in three of our four markets, publishes **four different
> numbers, two of them on the same country's site.** The cap's real job — stopping the summary
> becoming a checklist — is now done by the ordering rule below.

- **It prints only when it earns its place.** A summary is written **only** if it carries a
  **concrete achievement** — a named thing done, with a result or a number, drawn from the
  candidate's own confirmed material — **or a fact the advert being applied to actually tests.**
- **If neither exists, the whole section is omitted, heading included.** Never a `Professional
  Summary` heading with nothing under it: that is not a missing summary, it is a broken CV.
- **Order, and it is the rule that replaces the word cap:** the achievement first · one line of
  context **only** if it says something the page does not already say · the advert's tested facts
  compressed into **one short closing clause**, which may **never** displace the achievement.
  Nothing else belongs in it.
- **Banned outright:**
  - **The identity opener** — `Senior Project Manager with 7+ years of experience...`. The title is
    already the headline and the years are already in the experience section. Reviewers name this as
    *the* defect, and both structures practitioners actually recommend work by deleting it.
  - **Capability claims as content** — `proven ability to`, `expertise in`, `strong in`,
    `comfortable bridging`, `results-driven`. Three of the five summaries in our own six-CV corpus
    are built entirely from these, and the literature is consistent that accomplishment statements
    beat capability claims.
  - **Restating anything already visible** — title, employer, dates, years.
- **When there is no achievement to draw on**, the slot shows the hole visible and empty
  ([ADR-0002](../adr/0002-how-a-structured-fact-reaches-the-cv.md) clause 2) — `Led [which project?],
  [what result?]` — which does **not** print. **Never pad a thin CV with a generic paragraph:** the
  detectable failure is emptiness, not polish.
- **Voice: no first-person pronouns**, as before — but recorded honestly as **convention, not
  evidence**. 37% of 23,191 real summaries use *I / my / me*; third person (*he / she*) is under 1%
  and is the actual error. We pick the pronoun-free majority style and stop asserting it is a rule.
- **No per-market voice or structure**, even though SEEK tells Australian candidates to write in the
  first person. [ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) clause 2 already
  rules that a country page is a strip-list, never a market style guide.

⚠️ **Known and accepted:** the summary is **not** a decision signal in the strongest available
evidence — 221 recruiters over 2,043 eye-tracked screenings advanced CVs on time spent in
*Experience*, and the top block separated nothing. **No study anywhere measures callback rates for
having a summary.** These rules make it honest and non-generic; they do not claim it wins interviews.

### Length and bullet density (decided 2026-08-07, issue #153)

Full reference: `docs/research/bullet-budget-floor-vs-achievement.md`. These apply to every CV write
AND every later edit.

> 🚨 **The rule this replaces had no source.** It read *"per role 4-6 bullets; the current role may
> reach 8; roles older than ~8 years 3-4"*, sourced to
> `2026-05-03_it-pm-cv-best-practices.md`. Read at source, that file says one thing about counts —
> *"aim for 4-6 bullets per role"* — with **no citation**, under its own header caveat that it
> *"informs framing and vocabulary only"*. **The 8 and the 3-4 appear nowhere in it, and nowhere
> outside our own rules and our own code.** Externally: **no institution, standard, parser vendor or
> professional body publishes a per-role bullet cap at all** (Purdue OWL sets a minimum of three and
> no maximum; Rezi, the only commercial product with a hard count, picks 3-6). It is a craft
> convention and every product implementing one picks a different number.

**The budget is the page. The per-role number is a guard rail, not a target.**

- **Two pages maximum, single column.** This is the real constraint; per-role density falls out of it.
- **The newest role gets first call on the page. Each older role takes less than the one before.**
  A ladder of *spend*, never a table of caps — it holds for three roles and for eight without a new
  number, and an advert can still overrule it when an older role is the relevant one.
- **No single role exceeds 10 bullets.** ⚠️ **This 10 is our design opinion, recorded as one — not a
  finding.** Its job is to stop one role eating the CV, nothing more. Measured on the owner's own CV,
  two pages holds roughly **24 experience bullets**; across three roles that is ~8 each, so **8 was a
  reasonable average and an unreasonable cap** — a rope sits above the average precisely because
  roles are unequal. **The ~24-bullets figure is now measured against our own renderer** (#312,
  2026-10-01): the real browser printing `renderPreviewHtml()`'s output at 24 bullets lands on
  exactly 2 A4 pages, and `apps/api/scripts/print-gate.mjs` re-measures it at every release gate.
  The page count is read back from the produced PDF itself; the budget's enforcement on the live
  approve path (over two pages → tighten once, then ship and tell) lands with #314.
- **First call is not a floor.** A role with 4 good bullets prints 4. Never pad to reach a number:
  a floor is what produced the merge damage below.
- **A role is one flat bullet list. No sub-headings inside a role** (decided 2026-08-07, issue #155).
  All of a role's bullets count together toward the rope; a source CV that groups some of them under
  a heading has them counted, and rendered, as one list.

> 🚨 **The sub-group construct was deleted, deliberately — do not re-derive it.** This file used to
> specify it in full (canonical term *"Key Deliveries"*, standalone italic line, 2+ achievements
> only, one per role, counting toward the cap) and **the renderer has never been able to emit one**:
> a role's bullets are a flat array of strings with no sub-heading slot, so the rule read as
> normative and was silently dead. Three reasons it was deleted rather than built. **It is the
> rope's evasion route** — the owner's own BRED role is *7 duty bullets + 8 under
> `Project Achievements` = 15*, which is exactly how a role with a rope of 10 becomes a role with
> 20. **Every parser surveyed reads a role as a flat bullet list**, and practitioners warn that
> parsers infer structure from vertical whitespace, so a sub-heading risks being read as a section
> break. And **#153 removed the pressure that made a second block attractive** — a role no longer has
> to cram everything in, because what does not fit is now chosen away visibly rather than squeezed.
> ⚠️ **The owner's own CV uses `Project Achievements` under all three roles.** Those bullets are
> mined against their job and print as ordinary job bullets — nothing is lost at the sentence level;
> only the grouping goes. ✅ Consistent with
> [ADR-0009](../adr/0009-a-work-project-stays-a-bullet.md), which had already refused a **named
> project container** inside a job; this closes the presentational half clause 6 routed away.
- **Roles are thinned by relevance and by the page, never by a date threshold.** The old *"older than
  ~8 years: 3-4"* is withdrawn: the threshold was invented, and a fixed age cap silences the one role
  an advert most wants (applying to a bank, the bank on the CV is the oldest role). The only recency
  number in the cited research is *"condense or drop experience older than 15 years"* — a different
  rule about a different thing, and not a bullet count.
- One to two lines per bullet, three absolute maximum.
- Outcome-led: action verb + scope + outcome where the source supports it. No responsibility-only or
  attendance bullets.
- When editing an existing CV, re-check these limits before saving the new version.

**When a role has more to say than fits: choose, do not squish.**

Print the bullets this advert wants, whole, with their outcomes intact. The rest do not print, the
candidate is **told which**, and may put any back **for that one application** — never as a standing
setting ([ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) clause 4: the machine
never removes silently, and a removal is reversible per application).

**Merge only two bullets that genuinely say the same thing. Never as a way to make room.**

**Splitting is the writer's job, not the miner's** (#208). A claim holds one printed line of the
source CV whole, several actions and all — the miner no longer atomises it, because splitting at
capture re-decides the unit on every read (the mechanism behind the 17→44 skills swing, ADR-0004
clause 3). The writer splits a compound claim into two bullets when **this advert tests more than
one of its actions and each stands as its own line**. Both bullets cite the same claim id: one
claim, two printed lines, which `conservationIssues()` accepts by design.

Three limits, and the first two are enforced (#208): **two bullets maximum from one claim** — a
third is padding the role; **a split keeps the line's figures**, because splitting is a claim to be
rendering the line in full, so every number in the claim must land on one of the two bullets; and
**never split a result away from the action that produced it**, which is writing discipline the
lint cannot see when the result carries no digit.

**A merged bullet must keep a result, and the result must print** (#154). This is the precedence
between this section and the outcome-led rule above, stated once, here — the tailor prompt carries
it in full because the writer never sees this file, and cites this section as its source:

- A line built from more than one source claim must state what was achieved, and the writer
  **declares that outcome in the bullet's own `outcome` field**. The declared outcome must appear
  **word-for-word in the printed line** — a result named in a field but absent from the sentence is
  a result the employer never reads, and the check would pass on the very scope-list this rule
  exists to prevent.
- **If no source states a result, do not combine.** Print one claim and leave the other in
  `unprinted`. The escape from a crowded role is choosing (ADR-0007), never inventing an outcome
  the source does not carry — an invented outcome is a system inference wearing a source-supported
  fact's clothes, which ADR-0004 clause 1 forbids outright.
- **The rule is two; the alarm fires at four.** `conservationIssues()` warns only at four or more
  source claims in one line, where the squish is unarguable — the owner's own BRED case. Three is
  tolerated silently because a false warning costs the reader's trust in every true one. (The
  original reason was that atomic mining split one CV sentence into several claims, so three was
  often one sentence reassembled. #208 ended atomic mining; the gap of two was kept anyway, on the
  false-alarm argument alone. If merged lines get worse, tightening to three is the lever.)

⚠️ **Honest limit:** this guarantees **one** surviving result per line, not all of them. A line
combining three claims and keeping one result passes.

🔇 **The alarm is currently shown to nobody — dropped on purpose** (owner decision 2026-08-22,
#273, executed by #272). The only screen that ever printed the over-packing warning (*"one printed
line carries N facts at once"*) was the pre-signup draft screen, which #272 deleted along with the
draft itself; the warning was not re-homed. The detection is untouched: `conservationIssues()` and
`draftDisclosure()` still flag four-or-more-claim lines mechanically, and the four-claim threshold
above still binds the writer. What changed is only that no surface tells the person. Recorded here,
beside the rule, because a rule that silently stops being surfaced is how a stance rots into a lie —
if a tailored-CV surface returns (post-deck), deciding whether this warning returns with it is part
of that build.

> 🚨 **Why "merge, never drop" is withdrawn as the default.** Measured on the owner's own CV, four
> source bullets merged into one went from **514 characters to 172 — two thirds of the words gone.**
> Every keyword survived; **every outcome clause died** (*strengthening customer security*,
> *improving customer autonomy and reducing support workload*, and two more), and three of four
> ownership verbs collapsed into one. The merged sentence is **one verb, four scopes, zero
> outcomes** — a scope list, the exact shape the outcome-led rule exists to prevent — and it passes
> every gate we have: 1.7 rendered lines (legal), all keywords present (ATS-invisible; Jobscan
> states outright that *"measurable results are not factored into the match rate"*), and
> `conservationIssues()` counts bullets, not outcomes.
>
> The instruction existed because dropping a fact felt like lying. **ADR-0007 changed that**: there
> is no unprintable fact, only a per-application choice the candidate sees and can reverse. Choosing
> is now the honest option and squishing is not.

**A printed bullet must carry the source claims it came from.**

Every claim reaches the writer **with its id**; every printed bullet records **which ids it came
from**. This is what makes the three rules above checkable rather than merely stated:

- *"N more from this role aren't shown"* is computable — without it, choosing becomes a **silent**
  removal, which ADR-0007 clause 4 forbids.
- A merge is visible as a bullet carrying more than one id, instead of being discovered years later.
- A bullet carrying **no** id is one the machine invented — the same shape
  [ADR-0004](../adr/0004-each-elements-own-parts.md) clause 1a already requires of every structured
  fact: *a fact pointing at nothing is a defect, not a low-confidence result.*

⚠️ **Honest limit:** the writer assigns these ids and will sometimes assign them wrongly. This buys
**checkable**, not **correct**.

✅ **This section is live** (#158, built 2026-08-09; it was decided on #153). The three code sites
that contradicted it have been changed: `apps/api/src/preview.ts` now enforces the rail of 10 with
**no floor** (the `Math.min(6, sourceBullets)` current-role floor is deleted), every printed bullet
carries `claimIds` validated against the real source claims by `conservationIssues()` (a fabricated
id is flagged by name), and each role records its `unprinted` candidate bullets by claim id ·
`apps/api/prompts/preview-tailor.md` rule 8 states the spend ladder — with the posting-relevance
exception above — and *"merge weak or overlapping bullets instead of dropping them"* is withdrawn
in favour of choose-and-record · `buildTailorInput()` sends each claim **with its id**. Rule 4's
separate recency rule (*"if there are more than 8 roles, compress the oldest into 1-2 bullets"*)
folded into the spend ladder and stopped being a second hidden rule. Honest limit that remains:
nothing yet checks that cited ∪ unprinted **covers** the source — a claim dropped without being
listed passes silently (the *"N more not shown"* control is #157's build).

**Visual formatting and section design** — full reference: `/research_result/2026-06-09_cv-formatting-design-standards.md`. Apply on every CV write:
- **Section order is fixed by the root CV** (Summary, Professional Experience, Personal Projects, Skills, Education, Additional Information). Never move Skills above Professional Experience (council-validated 2026-06-11).
- **Never write a skills/competencies block as a run-on comma paragraph.** Use 2-4 categorized groups, each a bold category label on its own line followed by a comma-separated list. 8-12 skills total. (Markdown: a line wrapped entirely in `**...**` renders as a bold sub-label; put the comma list on the next line with no blank line between.)
- **Do not run two near-identical Skills and Core Competencies blocks.** Default to one categorized Skills section; only keep a separate Core Competencies snapshot if it genuinely differs (and is itself categorized, never a run-on).
- **Bold the key info in EDUCATION and ADDITIONAL INFORMATION.** Education: `**Institution - Location**, year` then the degree (plain) on the next line. Additional Information: `**Nationality:** value`, `**Languages:** ...`, `**Certifications:** ...` — bold label, plain value.
- Employer line bold; date line and italic role title (`*Role*`) each on their own line. First `##` is the centered role headline (the builder injects the "Professional Summary" heading after it).
- **No sub-headings inside a role** (deleted 2026-08-07, issue #155 — full reasoning under *Length and bullet density*). A role renders as the employer line, the role title line, and **one flat bullet list**. Never `*Key Deliveries*`, `Achievements`, `Project Achievements` or any other label above part of a role's bullets, in any form — italic line, inline prefix or plain text.
- Bold only: name, section headings, employer, job title, skills category labels, education institutions, additional-info labels. Never bold whole sentences or bullet bodies.

---

## Writing Style (full — was CLAUDE.md §6)

**Before writing or modifying CV content for PM roles, read** `/context/research_notes/2026-05-03_it-pm-cv-best-practices.md`. It covers CV length, bullet formula, and 2026 trends; it takes precedence over generic CV conventions, EXCEPT its section-order advice, which is superseded by the root-CV order rule above (Skills after Professional Experience).

- Professional, direct, modern, concise. Optimized for IT recruiters and hiring managers.
- **Strong action verbs**: led, delivered, coordinated, prioritized, owned, defined, scaled, automated, aligned, translated, facilitated, negotiated, mitigated.
- **Outcome-oriented** bullets: action + scope + outcome (when outcome is in source).
- No first-person pronouns, no exaggerated claims, no decorative fluff, no emojis.
- Bullet length: one to two lines. Numbers as figures (e.g. "12 stakeholders", "€2M budget").
- **No AI-typographic artifacts**: no em dashes (—), en dashes (–), pipe characters outside tables, ellipses (…), semicolons as list separators. Use plain commas, full stops, or line breaks.
- **No AI-language tells**: read `/research_result/2026-05-09_ai-writing-tells.md` for the full banned-word and banned-opener lists. Vary sentence length. Do not close paragraphs by restating the opener.

---

## Quality Checklist (full — was CLAUDE.md §10)

Apply before finalizing any tailored CV:

- [ ] No dates, employers, titles, certifications, or metrics were invented.
- [ ] Every non-Verified/non-Derived item appears in the audit with risk level and recommended action.
- [ ] All High-risk audit items reviewed by the candidate before submission.
- [ ] ATS compliance verified per `/research_result/2026-05-03_ats-parsing-pitfalls.md`.
- [ ] One date form (`Month YYYY` or `MM/YYYY`) used across every role, certification, and education
      entry; no year-only, year-first, or two-digit years; `Present` for the current role. Year-only
      dates inherited from the source are preserved exactly, never filled in.
- [ ] Any role whose end is unknown prints its start alone (`2003`) in its chronological place — never
      `Present`, never `Since`/`From`, never a role with no date line.
- [ ] No date prompt or placeholder appears anywhere on a tailored CV.
- [ ] Education years print exactly as held.
- [ ] The summary carries a concrete achievement or a fact the advert tests — otherwise the section is
      absent entirely, heading included.
- [ ] The summary opens with the achievement, not with an identity clause, and contains no capability
      claims (`proven ability to`, `expertise in`, `strong in`, `results-driven`) and nothing already
      visible elsewhere on the page.
- [ ] CV fits two pages. The newest role has the most bullets, each older role fewer than the one before, and no role exceeds 10 — counting all bullet blocks under a role together. No role padded to reach a number.
- [ ] No role carries a sub-heading over part of its bullets (`Key Deliveries`, `Achievements`, `Project Achievements`). One flat list per role.
- [ ] Where a role did not fit, bullets were **chosen**, not squished: no bullet merges more than two source points, and no merge dropped an outcome the source stated.
- [ ] Output filenames follow CLAUDE.md §9 conventions; no prior version overwritten.
- [ ] Tailoring report saved with all decisions (kept/edited/removed/confirmed) recorded.
- [ ] User-confirmed additions persisted to `/context/`.
