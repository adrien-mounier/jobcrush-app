# A job gets at most 8 bullets. How is that budget split between the facts every job in the family expects and the achievements only this person has — and can that split be a rule?

_Deep-sources research commissioned directly by the owner on **2026-08-06**. **No GitHub ticket exists
for this** — it is a live design question asked before it becomes one, and it sits under map
[#127](https://github.com/adrien-mounier/jobcrush-app/issues/127) alongside the element decisions
ADR-0004 to ADR-0008. A `/last30days` companion may follow to cover recent practitioner movement._

_This half covers established, high-trust primary sources: public occupational datasets read at
source (ESCO's live API, the O\*NET 30.3 database downloaded and computed over), shipped products'
own documentation and source code, institutional career-service guidance, methodologically-stated
studies, and this repo's own code, CV brain and CV corpus._

**What this document is not.** It is not a re-derivation of the **family floor vs discriminator**
distinction — [`../cv-brain/tailoring-reasoning.md`](../cv-brain/tailoring-reasoning.md) §4 already owns
it, it was misread once in [#6](https://github.com/adrien-mounier/jobcrush-app/issues/6), and this
document takes the 2026-07-23 clarification as settled. It is not a design for the floor and it does
not propose a build. It does not re-derive
[`work-projects-inside-a-job.md`](work-projects-inside-a-job.md) (the `Project Achievements` heading is
a **label over a second bullet list**, not a project entry — that finding stands and this document
depends on it) or
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md).
Where it contradicts the repo's own notes it says so loudly.

---

## Bottom line

**1. 🚨 The one empirical claim holding up the floor/discriminator split is contradicted by this
repo's own advert corpus, and it is contradicted on the owner's own example.**
`tailoring-reasoning.md:58-62` justifies dropping the shared baseline this way: *"Budget is dropped
here precisely because **every PM ad asks for it**, and that is exactly why a PM CV cannot be missing
it."* Counted across the 17 adverts in `apps/api/data/sample-postings.json`: **budget appears in 7 of
17**, and **agile/scrum/sprint appears in 3 of 17 — and one of those three is boilerplate**
(Manulife's *"You think big, with curiosity to discover ways to use your agile approach"*, in a
*What motivates you?* block, not a requirement). **Two of seventeen adverts actually require Agile.**
The owner's *"basic expected for a role"* example is an Agile/Scrum ceremonies bullet. On the evidence
this repo already holds, it is not what every PM ad asks for. ⚠️ Caveat stated plainly: the stored
excerpts are truncated at 2,200 characters, which usually cuts the *Requirements* block at the bottom
of an advert, so these are **lower bounds**. But nothing in this repo has ever measured the claim, and
the number that exists does not support it.

**2. 🚨 ESCO — the only dataset that ships an explicit essential-vs-optional flag — puts Agile in
the *optional* column and *recruit employees* in the *essential* one.** Read live from the ESCO API,
`ICT project manager` (`occupation/8b6388a4-4904-471b-9331-d3b1211f5525`, ISCO 1330.7) carries **20
essential** and **40 optional** skills. Essential includes *recruit employees*, *train employees*,
*coach employees*, *manage staff*, *apply conflict management*, *provide cost benefit analysis
reports*. Optional includes *Agile development*, *Agile project management*, *Waterfall development*,
*Lean project management*, *DevOps*. **A floor derived mechanically from ESCO would put "recruited and
trained project staff" on a PM CV and leave Agile off it** — the exact inverse of what our market's
adverts and our own CV brain assume. Four of the twenty essentials appear in ≤4 of our 17 adverts;
*cost benefit analysis* appears in **0 of 17**.

**3. 🚨 O\*NET has no rated data at all for the occupation we serve.** `13-1082.00 Project Management
Specialists` carries 20 task statements, every one of them `Task Type: n/a`, `Incumbents Responding:
n/a`, `Domain Source: Analyst` — **zero task ratings, and the occupation is absent from the Work
Activities file entirely** (894 SOCs have work-activity ratings; ours is not one of them). Computed
first-hand over the full O\*NET 30.3 download. And where ratings *do* exist they barely rank:
across all 894 rated occupations the **median spread between an occupation's most and least important
task is 1.34 points on a 1-5 scale**, **96.7% of all task importance ratings are ≥ 3.0**, and **0.0%
are below 2.0**. Nothing is unimportant. A "top N by importance" cut is a cut through noise.

**4. 🚨 The 8 is not in the research it cites, and neither is the rest of the ladder.**
`cv-authoring-rules.md:85` sources the density limits to
`docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md`. That file says one thing about counts:
*"Aim for 4–6 bullets per role"* (line 83). **The number 8 does not appear in it. Neither does
"roles older than ~8 years: 3-4."** The file's own header reads *"Source method: Gemini CLI web
research across four targeted queries"* and *"Caveat: Research outputs inform framing and vocabulary
only."* It carries no citations for the density numbers. A repo-wide grep finds no other justification
anywhere. **The cap that creates the allocation problem is an un-sourced number invented downstream of
an un-cited line.** The owner said *"let's say we respect the 8 bullets rule"* — he should know it is
not a rule, it is a guess, and the problem it creates is partly self-inflicted.

**5. The honest answer to "does anything measure duties vs achievements?" is no. Nothing does.** The
Ladders 7.4-second study is not peer-reviewed, never published its full method, and used 30 recruiters.
The best available peer-reviewed eye-tracking study of CV screening (Frontiers in Sociology, 2024, 40
Swedish recruiters, 10 fictitious CVs) has *experience* as a single area of interest and **never splits
it into duties and achievements** — its subject is discrimination, not content. The 4.2× and 3.2×
"quantified achievements" figures that circulate trace only to SEO career sites; the "Harvard Business
Review" attribution is uncited and I could not find an original. **There is no experiment, audit study
or field trial anywhere that manipulates the duty/achievement mix and measures a callback.** Any rule
we write is a design opinion, and it should be labelled as one.

**6. Not one shipped product implements a ratio, and the two most-starred open-source tailors don't
budget bullets at all — they budget *pages*.** `santifer/career-ops` (63k★) *"Reorder experience
bullets by JD relevance"* — reorder, never select — and enforces `--max-pages` with a two-page warning
threshold. `MadsLorentzen/ai-job-search` (30k★) requires *"CV is exactly 2 pages - not 1, not 3"* and
has **no bullet rule whatsoever**. `srbhr/Resume-Matcher` (28k★) only ever *adds*: *"DO NOT rewrite or
replace existing bullets - only add new ones."* Rezi ships the only hard count — *"Aim for 3 to 6
bullet points for each experience entry"*, *"at least three"*, whole-CV *"between 400 and 1600 words"*.
**The single ratio found anywhere is 2:1, and it is a fill-in-the-blanks profile template**
(`[KEY_RESPONSIBILITY_1] / [KEY_RESPONSIBILITY_2] / [KEY_ACHIEVEMENT]`), not a selection algorithm.

**7. Merging is safe for every machine and lossy for the only reader who matters — and it breaks our
own writing rule while satisfying our own merge rule.** The owner's example merge, measured: **4 source
bullets, 514 characters, 64 words → 1 bullet, 172 characters, 18 words. 67% of the text gone, 3 slots
freed, and it still fits the one-to-two-line limit.** What survives is every noun. What dies is every
outcome — *"strengthening customer security"*, *"improving customer autonomy and reducing support
workload"*, *"driving alignment between upstream APIs, business requirements, and customer-facing
delivery"* — and three of four ownership verbs. Jobscan states outright that *"Resume word count and
measurable results are **not** factored into the match rate"*; Textkernel anchors a skill to a
**work-history item id** (`"foundIn": "exp_3"`), never to a sentence; our own judge receives a flat
`- id: / text:` list with no grouping (`apps/api/src/judge.ts:66-74`). **No machine can tell the
difference.** But `cv-authoring-rules.md:88` demands *"action verb + scope + outcome where the source
supports it"*, and the merged bullet has one verb, four scopes and zero outcomes. **`preview-tailor.md` rule 8 and the outcome-led
rule are in direct conflict, and nothing in the code notices.**

**8. 🚨 The two "floors" in this repo are two different artefacts wearing one name, and building one
does not give you the other.** `tailoring-reasoning.md:63-66` says the floor's shape *"is written down
in `docs/onboarding-reward-design.md` §6.2"*. **There is no §6.2** — §6 has no subsections at all; the
nearest real contract is §13 (line 340). And §6's floor is a **question list**, not a content
checklist: it is satisfiable by *"an explicit negative"*, which §6 then stores as *"a first-class,
**non-renderable** negative so JobCrush does not... imply the missing capability on a CV"*. **A §6 floor
item can be fully covered by content that must never print.** The clincher: the shipped discovery floor
is three dimensions — `["years-experience", "work-rights", "language"]`
(`apps/api/src/eligibilityDiscovery.ts:128`) — and **not one of them is ever an experience bullet.**
The two floors do not currently intersect at a single bullet.

**9. 🚨 The owner's own "boring expected fact" example is, by §4's own tally, a Product Owner
discriminator.** His bullet reads *"sprint planning, backlog refinement, retrospectives, and daily
stand-ups"*. `tailoring-reasoning.md:72` puts **agile familiarity** in the shared baseline; line 78-79
puts **sprint ceremonies** and **backlog ownership** in the **Product Owner** cluster. One bullet, both
lists. Printing it on a CV targeting Project Manager both ticks a floor item *and* pushes the language
tally toward the wrong role family. **The unit that has to be classified is not the bullet — it is the
phrase inside the bullet.**

**10. The owner's hypothesis survives, but not for the reason he gave — and the part that is
irreducible is smaller and sharper than he thinks.** The *allocation* is expressible as a rule; a
coverage rule works and it is the rule every shipped product converges on. What is irreducible is the
**classification**: nothing in the pipeline can tell a duty from an achievement. There is no field, no
tag, no id prefix, no heading — the miner collapses both of his bullet lists into the same `role`
string (`packages/contracts/src/candidateClaims.ts:31`). **You cannot write "N duties and M
achievements" because the machine cannot count either side.** And the classification is not a property
of the sentence: his mobile-banking bullets match nothing Manulife states and are the whole point
against Computershare's *"build and launch a new mobile app"*. **Same sentence, floor against one
advert, discriminator against another. That is per-advert judgement and it cannot be precomputed.**

**11. His two examples are not comparable units, and he demonstrated the answer without noticing.**
Verified against his CV: example 1 is **one** of his bullets, lightly compressed (109 chars against his
198-char source line). Example 2 is **four separate bullets already merged** — A1 *Lao Forex Exchange*
+ A2 *card services integration* + A5 *PIN-code authentication* + A7 *self-service card activation*.
The brief's reading is correct. **He was not comparing a fact to an achievement; he was comparing one
bullet to four, and the four-into-one is exactly the mechanism `preview-tailor.md` rule 8 already
mandates.** The budget is not 8 items. It is roughly 8 to 12 rendered lines, and merging changes the
exchange rate between the two kinds.

---

## The repo's own material, read first

### The distinction already has a name, and §4's clarification is right

[`tailoring-reasoning.md:53-66`](../cv-brain/tailoring-reasoning.md) is the crux and it is unambiguous:

> *"The signals below decide **which role's language** the CV adopts. They are the words that
> *separate* PM from PO from PdM. A **family floor** is the opposite material: what *every* job in a
> family expects — largely the shared baseline this section deliberately throws away. **Budget is
> dropped here precisely because every PM ad asks for it, and that is exactly why a PM CV cannot be
> missing it.**"*

and

> *"The floor is **E5's offline family research and does not exist yet**."*

Line 71-72 gives the shared baseline: *"budget, user stories as a format, stakeholder management,
requirements gathering, agile familiarity."* The owner's first example lands squarely in it. **This
document takes all of that as settled.** What it questions is the *justification* sentence (finding 1),
the *pointer* to where the floor's shape is written down (finding 8), and the *classification* of his
specific example (finding 9).

The five content classes (§3, lines 39-45) do **not** help here. `Verified` / `Derived` /
`Partially Supported` / `Unsupported but Plausible` / `Unsupported` classify **how well evidenced** a
line is, not **what kind of content** it is. Both his duty bullets and his achievement bullets are
`Verified`. **The axis this question needs does not exist in the classification.**

The conservation principle (§6, lines 99-106) constrains the answer without deciding it: the tailor
*"may rephrase, reorder, merge, and select"* but not *"silently delete a class of facts."* A **class**
means certifications, languages, current-role density — enumerated in
`conservationIssues()` (`apps/api/src/preview.ts:187-230`). **"Achievements" is not one of the classes
it watches.** All eight of his project achievements could vanish and the lint would pass.

### The two floors, compared side by side — nobody had checked this

| | §4's **family floor** (`tailoring-reasoning.md`) | §6's **ranked essential floor** (`onboarding-reward-design.md`) |
|---|---|---|
| What it is | CV **content**: what a CV in this family cannot be missing | **Questions**: *"the smallest set of questions needed to cover its ranked essential floor"* (line 163-164) |
| Unit | A bullet on a page | An item with *"importance band, fast question, answer options, destination CV section"* (§13, line 340-341) |
| Ranked? | No. §4 is a tally you compare, not a list you walk | **Yes**, and the rank is load-bearing — *"ask the highest-ranked unanswered essential family item"* (line 179) |
| Satisfied by | Content that prints | *"a source-supported fact; a user-resolved fact; **an explicit negative**; a defensible semantic equivalent"* (line 168-171) |
| Scarce resource | The bullet budget (8) | The question budget — *"short and ranked enough to finish without coercion"* (line 188-189) |
| Where it's specified | Nowhere. The pointer to `§6.2` **does not resolve** | §6 and §13 |

**The divergence is exact and it is the negative.** §6 line 173-174: *"'No' is a complete answer. Store
it as a first-class, **non-renderable** negative so JobCrush does not ask again or imply the missing
capability on a CV."* A discovery-floor item answered *No* is **covered**. The same item on the CV floor
is **absent, permanently, and must stay absent**. One artefact treats a gap as closed; the other treats
it as a hole. They cannot be the same list.

**And the shipped rank cannot be reused.** `ASK_DIMENSIONS` today is
`["years-experience", "work-rights", "language"]` (`apps/api/src/eligibilityDiscovery.ts:128`). Of
those three: *years-experience* prints in the summary, *language* prints in `additional`, and
*work-rights* — the hardest gate, the one that withdraws a posting outright — **prints nowhere at all**
and per [ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) never needs to. The discovery
floor ranks by *what unblocks matching soonest*. A CV floor would have to rank by *what a reader
notices missing*. Those orders are not the same order.

**Verdict: two things, one name. Building the discovery floor gives you a question list with CV
destinations. It does not give you a per-family content checklist, and it does not give you a rank you
can spend a bullet budget against.** The §4 note's claim that the shape *"is written down"* in §6.2 is
the weakest link in the chain, because §6.2 does not exist.

### What the pipeline can and cannot see

- **The Draft cap is hard and it is 8**: `bullets: z.array(z.string()).min(1).max(8)`
  (`apps/api/src/preview.ts:117`). A ninth bullet is a validation failure, not a warning.
- **The floor the lint actually enforces is 6, not 8**: `const floor = Math.min(6, sourceBullets)`
  (`preview.ts:219`). So the machine's real demand for the current role is *"between 6 and 8"*, and
  `preview-tailor.md` rule 8's *"never render with fewer bullets than the source supports (up to 8)"*
  overstates what is checked.
- **Nothing anywhere distinguishes a duty from an achievement.** The miner's only structural slot is
  `role`, documented as *"employer+title as written, or 'profile'"*
  (`packages/contracts/src/candidateClaims.ts:31`). His `Project Achievements` heading is not a claim,
  not a tag, and not recoverable downstream.
- **The judge sees no grouping at all.** `buildJudgeInput()` (`apps/api/src/judge.ts:66-74`) emits
  `- id: … / text: …` and nothing else. It cannot know which job a sentence belongs to, let alone
  whether it is a duty. This was established in
  [`work-projects-inside-a-job.md`](work-projects-inside-a-job.md) finding 6 and it applies here
  unchanged.
- **`conservationIssues()` counts three things** — certifications, languages, current-role bullet
  count. A tailored CV that keeps 8 duty bullets and drops all 8 achievements passes clean.

### The owner's CV, measured

Read from the text layer with the repo's own extraction seam (`apps/api/src/extract.ts:28-45`):

| | Count |
|---|---|
| Pages | **3** |
| Words | **1,098** |
| Bullet lines (`●` + `○`) | **55** |
| Experience-section words | 666 |
| Experience-section bullets | **35** |
| **BRED (current role)** | **7 duty + 8 under `Project Achievements` = 15** |
| Okoone | 5 duty + 2 achievements + 1 stat header + 4 sub-bullets = 12 |
| Societe Generale | 6 duty + 2 achievements = 8 |

**His own CV breaks his own rules twice over.** It is three pages, not two. And
`cv-authoring-rules.md:86` says explicitly: *"Count all bullets under a role together. Do not evade the
cap by splitting one role into several bullet blocks ('Achievements', 'Key Deliveries', etc.)"* — which
is precisely what his BRED entry does, at 15 against a cap of 8. The caps as written would cut his 35
experience bullets to **18** (8 + 6 + 4). **Nearly half his experience section is over budget before
any advert is considered.**

---

## Q1 — Does an authoritative "what every job in this family expects" dataset already exist?

**Short answer: one dataset ships the flag, and its answer disagrees with our market. The rest operate
at an altitude that does not convert into bullets. No family floor for "IT Project Manager" can be
lifted from any of them.**

### ESCO — the only essential/optional flag, read live from the API

ESCO's own definitions, verbatim from ESCOpedia:

> **Essential** — *"those knowledge, skills and competences that are usually required when working in
> an occupation, independent of the work context or the employer."*
> **Optional** — *"knowledge, skills and competences that may be required or occur when working in an
> occupation depending on the employer, on the working context or on the related specialization."*

That is exactly the family-floor concept, named and shipped. Fetched from
`https://ec.europa.eu/esco/api/resource/occupation?uri=…8b6388a4-4904-471b-9331-d3b1211f5525`, the
`ICT project manager` record (ISCO code 1330.7) returns **`hasEssentialSkill` = 20** and
**`hasOptionalSkill` = 40**. The 20 essentials, verbatim and in the order the API returns them:

> perform project management · create project specifications · *ICT project management methodologies*
> · identify legal requirements · perform risk analysis · **coach employees** · estimate duration of
> work · *internal risk management policy* · manage budgets · manage ICT project · build business
> relationships · *ICT project management* · **train employees** · **recruit employees** ·
> *quality standards* · **provide cost benefit analysis reports** · manage project information ·
> **apply conflict management** · perform resource planning · **manage staff**

(*italics* = `skillType: knowledge`; the rest are `skillType: skill`.)

**Three things disqualify this as a floor for us:**

1. **It disagrees with our market on the biggest item.** *Agile development*, *Agile project
   management*, *Lean project management*, *Waterfall development* and *DevOps* are all in the
   **optional 40**. ESCO is telling us Agile is context-dependent for an ICT project manager. Our CV
   brain treats Agile as universal baseline. Both cannot be right, and neither has been tested against
   adverts.
2. **Five of the twenty essentials are people-management, and our adverts barely ask.** Counted across
   our 17: *recruit/hire* **3/17**, *coach/mentor/train* **4/17**, *conflict* **1/17**, *cost benefit*
   **0/17**. A mechanical ESCO floor would demand a bullet about recruiting staff on the CV of a
   Bangkok banking PM applying to Hong Kong. It would also demand a *cost benefit analysis report*
   bullet no advert in our corpus has ever asked for.
3. **They are not CV-usable content and they are not ranked.** *"perform project management"*,
   *"manage budgets"*, *"manage staff"* are competence labels. They have no scope, no object, no
   outcome — the three things `cv-authoring-rules.md:45-46` requires of a bullet. And the API returns a
   **flat, unordered set of 20**: there is no importance, no weight, no rank. §6's contract demands a
   **ranked** floor. ESCO cannot supply the rank.

**A floor could be *seeded* from ESCO's essential 20. It cannot be *derived* from it.** Somebody has to
decide that *recruit employees* is not a PM CV bullet in this market, and that decision is not in the
data.

### O\*NET — the numbers exist, they do not rank, and for our occupation they do not exist

Downloaded the O\*NET **30.3** public text release (no registration required) and computed over it
directly.

**Finding A — our occupation has no ratings at all.** `13-1082.00 Project Management Specialists`
has 20 task statements, and **zero rows in Task Ratings**. Every statement reads
`Task Type: n/a`, `Incumbents Responding: n/a`, `Domain Source: Analyst` — analyst-written, never
surveyed. **It is also completely absent from the Work Activities file**: 894 SOCs carry work-activity
importance ratings; 13-1082.00 is not among them. 29 of the 923 SOCs with task statements are in this
unrated state, and ours is one of them.

**Finding B — where ratings exist, they do not discriminate.** Computed across all 894 rated
occupations, on O\*NET's own `IM` scale (Scales Reference: `IM · Importance · minimum 1 · maximum 5`):

| Statistic | Value |
|---|---|
| Median within-occupation spread (most − least important task) | **1.34** on a 1–5 scale |
| p25 / p75 spread | 1.04 / 1.68 |
| Mean of all task importance ratings | **3.99** |
| Share of ratings ≥ 3.0 | **96.7%** |
| Share of ratings ≥ 4.0 | 54.2% |
| Share of ratings < 2.0 | **0.0%** |

Nothing an occupation does is unimportant. The nearest rated neighbour,
`11-3021.00 Computer and Information Systems Managers` (N = 28–29 incumbents), spans **3.39 to 4.19**
across seventeen tasks — top: *"Manage backup, security and user help systems"* (4.19); bottom:
*"Purchase necessary equipment"* (3.39). **A cut at "top 6 by importance" is a cut through 0.8 points
of noise built on 28 respondents.**

**Finding C — the Relevance column ranks better than Importance, and O\*NET's Generalized Work
Activities are unusable as bullets.** `RT · Relevance of Task · 0–100` (percentage of incumbents for
whom the task is relevant) genuinely spreads — 65.6% to 100% for 11-3021.00 — and is the better signal
if anyone ever builds this. But the activity layer is hopeless: 11-3021.00's top-rated work activities
are *"Working with Computers"* (4.90), *"Getting Information"* (4.43), *"Identifying Objects, Actions,
and Events"* (4.31). No CV can carry those sentences.

### SFIA, e-CF, PMI/APM, Lightcast, LinkedIn — checked, and none of them ships a floor

- **SFIA 9** — `PRMG Project management`: *"Delivering agreed project outcomes by aligning appropriate
  management techniques, collaboration, leadership and governance to specific project and
  organisational contexts."* Defined at **levels 4–6 only**. SFIA structures a skill by **responsibility
  level**, not by essential-vs-optional membership of a role. **No floor. It answers "how senior", not
  "what must be present".**
- **e-CF (EN 16234-1)** — 41 competences; `E.2 Project and Portfolio Management` sits in the MANAGE
  area with proficiency levels 2–4. The framework's own material says E.2 *"does not represent the
  complete content of a 'Project Manager's' job role"* — an explicit statement that a competence is not
  a job. **No essential/optional split, no rank, and the level text is a paragraph, not a checklist.**
  The European ICT Professional Role Profiles page I tried returned **404**; ⚠️ recorded as *could not
  check*, not as a negative.
- **Lightcast Open Skills** — the one taxonomy that would actually produce an advert-derived floor:
  *"Lightcast Skills is a comprehensive taxonomy of over 33,000 skills collected from hundreds of
  millions of job postings, resumes, and online profiles"*, letting you see *"the top skills by job
  titles, occupations, O\*NET codes"*. ⚠️ **"API access is now available on a contract basis."** The
  per-occupation skill ranking is **behind a commercial contract — could not check, not checked and
  found nothing.** Note also what it would give us: a **frequency ranking**, not an essential flag.
- **APM** — the professional body for exactly this market. Its CV guidance asks for *"what you do/did,
  who you manage (numbers), what is your budget responsibility, methodology used, types of project
  managed"*. That is a **content prompt list**, and it is the closest thing to a floor any institution
  publishes for our family — but it is prose advice with no rank, no membership test and no
  completeness claim. **PMI — ⚠️ could not check**; equivalent guidance sits behind member access, as
  [`work-projects-inside-a-job.md`](work-projects-inside-a-job.md) already recorded.
- **LinkedIn Skills taxonomy** — ⚠️ **could not check.** No public per-occupation essential-skill
  document reachable; the skills graph is exposed through partner-restricted Talent APIs.

### The honest verdict on Q1

**A family floor cannot be derived from any of these. It can be seeded from ESCO's essential 20 and
sanity-checked against O\*NET's task statements, and then a human has to do three things no dataset
does:** strike the items no advert in our market asks for (five of ESCO's twenty), rewrite the
survivors from competence labels into CV-shaped content, and **impose the rank** — because the one
dataset with an essential flag has no rank, and the one dataset with numbers has no discrimination and
no data for our occupation.

**That is a research job of roughly the size §4 already predicted ("E5's offline family research"),
and none of it is judgement about *this candidate*.** It is judgement about the *family*, done once,
offline. **That half of the problem is not LLM-irreducible.**

---

## Q2 — Is there evidence on the right mix of responsibilities and achievements?

**No. Not weak evidence — none.** Stated plainly because it changes how much confidence any rule
deserves.

### The Ladders 7.4-second study

- **What it is:** Ladders Inc., a $100k+ job board, ran an eye-tracking exercise in 2012 and updated it
  in 2018. Headline: recruiters spend an average of **7.4 seconds** on a résumé.
- **Method, as far as it is published:** ~30 professional recruiters, eye-tracking during résumé review.
  ⚠️ **The full PDF returned HTTP 403 to automated fetch**; the method description here comes from HR
  Dive's and HR Daily Advisor's contemporaneous reporting and from the company's own press release.
- **The criticisms are the point:** n = 30 with no stated sampling frame; no disclosure of what roles
  were being screened or what instructions the recruiters were given; **never peer-reviewed and the
  full methodology never published**, so it cannot be evaluated or replicated. A recruiter who believes
  they are being timed screens faster.
- **It says nothing about our question.** Its findings are about *layout* — where the eye lands, in what
  order. It does not compare content types.

### The best peer-reviewed study available

**Fossati, Sofroniou et al., *"What do eye movements say about the choices recruiters make?"*, Frontiers
in Sociology, 2024.** Design: **40 recruiters** (20 pairs) from three Swedish finance and retail firms;
**10 fictitious CVs**; race, ethnicity, gender, education and work experience systematically varied;
CVs rated 1–7 for interview likelihood; eye-tracking dwell time recorded against six areas of interest:
**face, name/contact, motivation, education/thesis, experience, skills**.

**"Experience" is one undivided area of interest.** The study never separates duties from achievements
because its subject is discrimination, and its CVs carried *"one up to 7 years of experiences within
sales"* with generic skill lists — deliberately thin content. The authors' own limitations: they needed
*"a larger dataset to validate the patterns we observe in the current small scale experimental study"*,
and their respondents came from diversity-focused organisations so *"may not be representative"*.

**This is the highest-quality evidence that exists on how recruiters read a CV, and it cannot answer
the owner's question.**

### The numbers that circulate, traced

*"Resumes with five or more quantified achievements receive interview requests at 4.2 times the rate of
description-only resumes"* and *"resumes with quantified achievements are 3.2 times more likely to
receive interview callbacks"* — these appear across a dozen career-content sites. The 4.2× traces to
`jobfix.ai`; the 3.2× is attributed to *Harvard Business Review* with **no article, author, date or
study named**, in every instance found. **I searched for an original and found none. Do not let either
number into a spec.**

### Where the correspondence-study literature does and does not help

The résumé audit-study tradition (Bertrand & Mullainathan 2004 onward) is methodologically serious and
has been applied to employment gaps, illness, unemployment duration, age, majors and internships. **It
has never, as far as this search reaches, manipulated the duty-versus-achievement composition of the
experience section.** Kessler, Low & Sullivan's *Incentivized Resume Rating* is the nearest instrument —
it elicits employer valuations of résumé attributes rather than sending fake applications — and its
varied attributes are credentials and experience quantities, not bullet content. ⚠️ **The paper's PDF
would not render to text for me; this characterisation comes from its abstract and citing literature,
not from the full text.**

### What guidance *does* say, when it is institutional rather than SEO

- **Purdue OWL, Work Experience Section** — the single most-cited institutional page, and it says
  **duties**: *"Each job should have a minimum of three bulleted items with the most relevant **duties**
  listed first."* Bullets should detail *"duties you performed"*, chosen to *"highlight those duties
  that are most relevant to the position you are seeking."* **A minimum, no maximum, and relevance
  ordering. No achievement requirement, and no cap.**
- **Our own research note** takes the opposite line without a citation:
  *"Responsibility-based bullets — describing daily tasks rather than outcomes is the most common red
  flag for senior PM profiles"* (`2026-05-03_it-pm-cv-best-practices.md:190`). ⚠️ Same file, same
  uncited Gemini-CLI provenance.
- **Shipping products agree with our note, not with Purdue.** `career-ops`: *"Bullets should emphasize
  outcomes, systems, users, or business effects rather than task history"*, and it bans the openers
  *"responsible for"*, *"worked on"*, *"participated in"*. `Resume-Matcher` flags the identical list as
  *"Generic phrases"*. Rezi's Content criterion asks whether bullets are *"achievement-driven"*.

⚠️ **Read that convergence carefully.** Every one of those rules is about **phrasing**, not about
**content class**. They ban *"Responsible for managing project timelines"* — a bullet with no scope and
no outcome. None of them says *"do not describe a duty."* The owner's example
(*"Coordinate Agile/Scrum execution through sprint planning, backlog refinement, retrospectives, daily
stand-ups"*) is a duty **written the way the rules demand**: strong verb, concrete scope, no filler.
**The entire industry consensus turns out to be about how a duty is worded, and it has nothing to say
about how many of them belong on the page.**

---

## Q3 — How do shipped tailoring products allocate a limited bullet budget?

**Named, with how I know. Nobody implements a ratio. Two of the three biggest constrain pages instead
of bullets. Everyone else implements coverage.**

| Product | What it actually does with the budget | How I know |
|---|---|---|
| **santifer/career-ops** (63k★) | **Reorders, never selects.** *"Reorder experience bullets by JD relevance and by the risk map: strongest matching evidence first"*. Budget is enforced at the **page**: *"The rendered PDF has a two-page warning threshold by default. `--max-pages=N`… If the rendered PDF exceeds its threshold, generation warns loudly with the actual and allowed page counts plus trimming guidance"*. Coverage is by **keyword placement**: *"Distributed JD keywords: Summary (top 5), first bullet of each role, Skills section"* | Read `modes/pdf.md`, `modes/latex.md`, `modes/heuristics/recruiter-side.md` at source via the GitHub API |
| **MadsLorentzen/ai-job-search** (30k★) | **No bullet rule at all.** Hard page gate: *"**CV is exactly 2 pages** - not 1, not 3"*. Objective is keyword coverage: *"Posting keywords covered or honestly absent… genuine gaps left visible and **never stuffed**"*. Its **source profile template** carries the only ratio found anywhere: `[KEY_RESPONSIBILITY_1] / [KEY_RESPONSIBILITY_2] / [KEY_ACHIEVEMENT]` — **2:1, in the capture template, not the selection logic** | Read `CLAUDE.md` at source |
| **srbhr/Resume-Matcher** (28k★) | **Only adds. Never selects, never drops, no budget.** *"Your goal is to ADD new bullet points… DO NOT rewrite or replace existing bullets - only add new ones."* *"Generate 2-4 NEW bullet points to ADD"*, *"Keep bullets concise (1-2 lines each)"* | Read `apps/backend/app/prompts/enrichment.py` at source |
| **Rezi** | **The only hard count in a commercial product.** *"Aim for 3 to 6 bullet points for each experience entry"*; Format criterion: *"Include at least three bullet points for each experience entry"*; whole-document: *"Keep your resume between 400 and 1600 words"*; *"Try to keep your resume to one page, or two pages at most"*. Content criterion asks whether bullets are achievement-driven — **as a quality check, never as a quota** | Rezi's own user docs, *The Rezi Score Explained* |
| **Teal** | **Human toggles, machine scores.** The user attaches a job side by side and *"can easily toggle on and off your work achievements so you pack as much relevant punch without the extra"*. The Match Score reports keyword alignment. **The allocation decision is handed to the person.** ⚠️ Teal's help centre returned **403** to automated fetch; this comes from Teal's own product page and its posted tutorial | Teal product page + Teal's own LinkedIn tutorial post |
| **Jobscan** | **Pure coverage, and it explicitly ignores everything else.** *"Your match rate is based on your hard skills, education level…, job title, soft skills, and other keywords."* And, decisively: *"**Resume word count and measurable results are not factored into the match rate.**"* Hard skills weighted *"much more heavily than soft skills and one-word keywords"* | ⚠️ Jobscan's support article redirects to a landing page for automated fetch; both quotes come from search-engine indexing of `support.jobscan.co/hc/en-us/articles/360055995534`, not from the page read directly. Same caveat convention as RChilli in the sibling document |
| **Huntr** | **Coverage, in five buckets.** The keyword scanner *"scans for five types of keywords: hard skills, soft skills, education, knowledge, and industry"* and the tailor *"analyzes keywords, rewrites bullet points, and scores your resume against the job in real time."* **No documented budget or ratio** | Huntr's own product pages |
| **Kickresume / Careerflow** | ⚠️ **Could not establish documented behaviour.** No help-centre or engineering documentation found describing selection logic. **Recorded as unchecked, not as absent** | Searched; only marketing and comparison content reachable |

**The pattern is unmistakable and it is worth stating as a design finding, not a survey result:**

1. **Nobody rations bullets by kind.** Zero products implement anything resembling *N duties + M
   achievements*.
2. **The budget the market actually enforces is the page, not the bullet.** Two of the three biggest
   open-source tailors gate on page count and let bullet counts float. **We are the outlier in capping
   bullets at all**, and our cap is the un-sourced number from finding 4.
3. **The allocation rule the market has converged on is coverage** — cover the posting's stated
   requirements, in the candidate's own truthful words, and let that determine what earns a slot. That
   is exactly the second clause of the owner's candidate rule, and it is exactly what our own judge
   already computes.
4. **Where a product cannot decide, it hands the decision to the human** (Teal's toggles) rather than
   inventing a quota.

---

## Q4 — Is merging lossy in a way that matters?

**Yes — but not to any machine. Only to the reader, and to our own writing rule.**

### The arithmetic of the owner's own merge

His four source bullets, and the sentence he wrote to replace them, measured:

| | Chars | Words | ≈ rendered lines |
|---|---|---|---|
| A1 *"Implemented a trading platform (Lao Forex Exchange) integrated into the internal financial system."* | 98 | 13 | 1.0 |
| A2 *"Led end-to-end integration of card services into digital banking platforms, driving alignment between upstream APIs, business requirements, and customer-facing delivery."* | 169 | 20 | 1.7 |
| A5 *"Led the development and rollout of PIN-code authentication for the mobile banking application, strengthening customer security."* | 127 | 16 | 1.3 |
| A7 *"Designed and launched a self-service card activation feature, improving customer autonomy and reducing support workload."* | 120 | 15 | 1.2 |
| **Source total — 4 slots** | **514** | **64** | **≈5.1** |
| **Merged — 1 slot** | **172** | **18** | **≈1.7** |

(Rendered lines at ~100 characters per line, single column — the shape `cv-authoring-rules.md`
assumes.)

**The merge frees 3 slots and 3.4 lines, and destroys 67% of the words. It is legal under our own
one-to-two-line rule.** What survives: *mobile banking*, *PIN-code authentication*, *self-service card
activation*, *card services*, *digital banking*, *Lao Forex Exchange*, *integration* — every noun, every
keyword. What dies: three of four ownership verbs (*Implemented*, *Led*, *Designed and launched* all
become one *Delivered*), and **every outcome clause**: *strengthening customer security*, *improving
customer autonomy and reducing support workload*, *driving alignment between upstream APIs, business
requirements, and customer-facing delivery*, *integrated into the internal financial system*.

### Does any machine notice? No, three times over

- **Jobscan states it outright:** *"Resume word count and measurable results are not factored into the
  match rate."* The industry's most-used ATS-optimisation score is blind to the exact thing the merge
  destroys.
- **Textkernel anchors a skill to a job, not to a sentence.** Its skill objects carry
  `FoundIn` — *"a comma-separated list of Work or Education History items Id's indicating where the
  skill was found"*, values like `"exp_3, edu_2"`. The parser **does not record the sentence, the
  phrase, or the character offset.** Rearranging which bullet a keyword sits in, inside the same job,
  is invisible to it.
- **Our own judge is blinder still.** `buildJudgeInput()` (`apps/api/src/judge.ts:66-74`) sends
  `- id: … / text: …` — one line per claim, no employer, no job, no order that carries meaning. A merged
  claim is simply one longer line, and `card-judge.md` grades meaning against whatever text it is given.

**So the ATS answer is the expected one, and it is now verified rather than assumed: merging is free for
the machines.**

### Does the reader notice? Nothing measures it, and our own rules say yes

There is **no study** on compound-bullet readability in a CV context — the Q2 void applies here too.
What exists is convergent guidance, all of it stating the same limit:

- **Ours:** *"One to two lines per bullet, three absolute maximum"* (`cv-authoring-rules.md:87`);
  *"No 'wall of text' bullets. If a bullet exceeds two lines, split or trim it"*
  (`2026-05-03_it-pm-cv-best-practices.md:85`).
- **Resume-Matcher:** *"Keep bullets concise (1-2 lines each)."*
- **MIT CAPD** (established in the sibling document): PAR bullets, 1–2 lines each.

**The owner's merged bullet is 1.7 lines. It passes.** So the length rule does not catch it.

### 🚨 The rule it does break, and nothing checks

`cv-authoring-rules.md:45-46` and `:88`: *"**Outcome-led bullets:** action verb + scope + outcome (when
the source supports it). No responsibility-only or attendance bullets."*

The merged bullet is **one verb, four scopes, zero outcomes** — and the source supported four outcomes.
It is a *scope list*, the exact shape the outcome-led rule exists to prevent, produced by obeying
`preview-tailor.md` rule 8's instruction to *"merge weak or overlapping bullets instead of dropping
them."*

**Two live rules in this repo pull in opposite directions on the same sentence, and no code arbitrates.**
`conservationIssues()` counts bullets, not outcomes. **This is the most actionable finding in the
document: whatever is decided about allocation, rule 8's merge instruction needs the clause "a merge may
not drop an outcome the source stated" — or the density floor will keep manufacturing keyword lists.**

---

## Q5 — Is the 8-bullet cap defensible, and where did it come from?

### Where it came from: nowhere

Traced through the repo. `cv-authoring-rules.md:83-85` states the ladder and names its source:

> *"**Length and bullet density** — hard limits (source:
> `/context/research_notes/2026-05-03_it-pm-cv-best-practices.md`)… Per role: **4 to 6 bullets**. The
> current/most recent role may reach **8** only if every bullet earns its place. Roles older than ~8
> years: **3 to 4 bullets**."*

That file is in this repo at `docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md`. Read at
source:

- Its own header: **_"Source method: Gemini CLI web research across four targeted queries"_** (line 5)
  and **_"Caveat: Research outputs inform framing and vocabulary only"_** (line 6).
- Its only statement about counts, line 83: **_"Aim for 4–6 bullets per role; prioritise quality over
  completeness."_** No citation.
- 🚨 **The number 8 appears nowhere in it as a bullet count.** Nor does *"roles older than ~8 years:
  3-4"* — the file's only nearby number is *"Condense or drop experience older than **15** years"*
  (line 39), a different rule about a different thing.
- A repo-wide grep for `8 bullets` / `reach 8` / `max 8` / `up to 8` finds hits **only** in
  `cv-authoring-rules.md`, `preview-tailor.md` and `preview.ts` — the rules and the code. **Nothing
  justifies it anywhere.**

**So: the 4–6 comes from an uncited line in a Gemini-generated note whose own caveat disclaims factual
authority. The 8 and the 3–4 come from nowhere at all.**

### Externally: no source-backed per-role bullet cap exists

- **Purdue OWL** sets a **minimum of three** and **no maximum**.
- **Rezi**, the only commercial product with a hard count, says **3 to 6** — and caps the whole document
  at **400–1600 words**, a budget our owner's 1,098-word CV sits comfortably inside.
- **career-ops** and **ai-job-search** set **no per-role count** and gate on pages.
- **APM**, **CMU**, **MIT**, **Berkeley**, **Europass** — none states a per-role bullet count anywhere I
  could find.

**No institution, standard, parser or professional body publishes a per-role bullet cap. It is a
craft convention, and every product that implements one picks a different number.**

### The two-page budget it serves *is* defensible — and the best evidence points the other way

**ResumeGo (2018)** is the only study with a stated method: **482 professionals** with direct
recruitment experience, screening in a hiring simulation between **15 October and 2 November 2018**;
one-page CVs of **350–500 words** paired with two-page counterparts of **700–850 words** for the same
candidate. Of **7,712** résumé selections, **5,375 were two-page** — recruiters were **2.3× more likely**
to pick the two-page version, rising to **2.9× for managerial roles**. Two-page CVs scored **8.6/10**
against **7.1/10**, and were read for **4 minutes 5 seconds** against **2 minutes 24 seconds**.

⚠️ **Conflict of interest, stated:** ResumeGo sells résumé writing. The study also concedes it is
*"only a simulation intended to replicate how recruiters behave."*

**But note what it does to the 7.4-second premise.** In a setting where recruiters were actually
choosing, they read for **minutes, not seconds** — and they preferred **more** content, most strongly at
the seniority our users occupy. The two-page budget survives. **The instinct that the budget must be
brutally rationed does not.**

### The one-sentence answer the owner asked for

**The 8 is arbitrary — it is not in the research this repo cites for it, and no external source supports
any per-role bullet cap — so a meaningful part of this allocation problem is self-inflicted, and the
cheapest available fix is to make the budget the page (as the market's two biggest tailors do) rather
than a number nobody can source.**

---

## Q6 — Can the allocation be a rule? Worked end to end

**The candidate rule under test:**

> *Cover the family floor once and minimally; spend every remaining slot on evidence for requirements
> this advert actually states.*

### The candidate, verbatim: BRED Banque Populaire, 15 source bullets

**Duty list (7):**

- **D1** Lead end-to-end banking IT projects covering core banking systems, mobile banking, and digital transformation programs, ensuring full compliance with banking regulations, PCI DSS, and internal IT governance frameworks.
- **D2** Coordinate cross-functional, international teams (developers, QA, business analysts, cybersecurity, external vendors) across Europe, Asia-Pacific, and Africa, managing scope, timelines, risks, and dependencies on mission-critical systems.
- **D3** Act as primary interface between IT, business stakeholders, and external partners, running regular stakeholder reviews and solution demonstrations.
- **D4** Apply Agile / Scrum delivery practices, running sprint planning, backlog refinement, retrospectives, and daily stand-ups to maintain steady delivery cadence across cross-functional banking IT teams.
- **D5** Prepare and present formal project status reports and steering committee presentations for management, consolidating delivery progress, risks, and key decisions across ~4 concurrent banking IT projects.
- **D6** Maintain a formal risk register across active projects, proactively tracking, escalating, and mitigating risks to protect delivery integrity and governance compliance on mission-critical banking systems.
- **D7** Designed and delivered 10 AI workshops for the eBanking department (~30 participants), driving practical and compliant AI adoption across the team.

**`Project Achievements` list (8):**

- **A1** Implemented a trading platform (Lao Forex Exchange) integrated into the internal financial system.
- **A2** Led end-to-end integration of card services into digital banking platforms…
- **A3** Mapped manual PM/analyst workflows into structured LLM logic, then built and deployed an agentic assistant tracking project progress, monitoring email, issuing deadline reminders.
- **A4** Rolled out the assistant to a 6-person cross-functional pilot team… the branch's first AI-driven work process.
- **A5** Led the development and rollout of PIN-code authentication for the mobile banking application…
- **A6** Coordinated the integration of third-party services (Telegram) into internal banking systems within strict security constraints.
- **A7** Designed and launched a self-service card activation feature…
- **A8** Led the design and development of an LLM-based Splunk log-triage workflow…

⚠️ **D7 is an achievement sitting in the duty list** — quantified, one-off, outcome-led. The headings do
not partition the content the way the owner's framing assumes. **Any rule that trusts the headings is
already wrong on his own CV, and the headings do not survive mining anyway.**

### Posting A — Manulife, Senior IT Project Manager (Delivery Manager), Ho Chi Minh City

Chosen because it is in a market ADR-0007 says we serve, in his exact domain. Its stated requirements,
condensed: coordinate business and technical stakeholders through all phases · plan, run and complete
projects · meet timeline, quality and budget · interact with business users and leadership · complete
project audits and reviews · identify, analyse, mitigate, document and control risks · communicate to
team, stakeholders, sponsors, management · identify resource needs and establish roles · negotiate
contract terms with consultants and vendors · assist in hiring and coach the project team · manage
technical components and evaluate personnel · own the delivery technology roadmap and drive digital
transformation.

**Running the rule:**

**Step 1 fails immediately.** *"Cover the family floor once"* names an artefact that **does not exist,
has no shape written down anywhere that resolves** (finding 8), and cannot be lifted from any dataset
(Q1). To run the example at all I have to invent a provisional floor. Taking ESCO's essential 20,
striking the five items no advert in our corpus asks for, and rewriting the survivors as CV content
gives roughly six: **delivery ownership end-to-end · stakeholder coordination · risk management ·
planning and scheduling · budget/cost · governance and reporting.**

**Step 2 degenerates.** Compare that provisional floor against Manulife's twelve requirements. **Every
one of Manulife's stated requirements is floor material.** The advert states nothing that is not already
in the floor. So *"spend every remaining slot on evidence for requirements this advert actually states"*
resolves to **the same content as clause 1**. The rule's second clause does no work.

**What the rule selects, if obeyed literally:**

| # | Bullet | Source | Why |
|---|---|---|---|
| 1 | Lead end-to-end banking IT projects across core banking, mobile banking and digital transformation, ensuring compliance with banking regulations, PCI DSS and internal IT governance. | D1 | floor: delivery ownership; advert: plan/run/complete, digital transformation |
| 2 | Coordinate cross-functional international teams (developers, QA, business analysts, cybersecurity, external vendors) across Europe, Asia-Pacific and Africa, managing scope, timelines, risks and dependencies. | D2 | floor: coordination + planning; advert: stakeholders, resource needs, roles |
| 3 | Act as primary interface between IT, business stakeholders and external partners, running stakeholder reviews, solution demonstrations and steering-committee reporting across ~4 concurrent banking IT projects. | **D3 + D5 merged** | floor: stakeholder + governance; advert: business users, leadership, communication |
| 4 | Maintain a formal risk register across active projects, tracking, escalating and mitigating risks on mission-critical banking systems. | D6 | floor + advert: identify/analyse/mitigate/document/control risks |
| 5 | *(slot spent on budget/cost — **he has no budget bullet**)* | — | **the floor demands it; the source cannot supply it** |
| 6 | Delivered mobile-banking PIN-code authentication, self-service card activation, card-services integration with digital banking, and Lao Forex Exchange platform integration. | **A1+A2+A5+A7 merged** | matches **nothing Manulife states** |
| 7 | Built and deployed an agentic LLM assistant tracking project progress and issuing deadline reminders, piloted with a 6-person cross-functional team as the branch's first AI-driven work process. | **A3+A4 merged** | matches **nothing Manulife states** |
| 8 | Designed and delivered 10 AI workshops for the eBanking department (~30 participants), driving practical and compliant AI adoption. | D7 | matches **nothing Manulife states** |

**Dropped outright: D4 (Agile/Scrum), A6 (Telegram integration), A8 (Splunk log triage).** Merged away:
three achievements' outcome clauses (Q4).

### 🚨 Four places the rule breaks, each demonstrated rather than argued

**Break 1 — the rule deletes the owner's own example.** D4 is his *"basic expected for a role"* bullet.
Manulife's only occurrence of the word *agile* is in a **motivation blurb**, not a requirement. Under
*"spend every remaining slot on requirements this advert actually states"*, D4 earns nothing. Under
*"cover the family floor once"* it earns a slot **only if Agile is in the floor** — and ESCO says
optional (Q1), our corpus says 2 of 17 (finding 1), and `tailoring-reasoning.md:78` classifies its
contents as a **Product Owner discriminator** (finding 9). **Three sources, three answers, for the one
bullet that started this question.**

**Break 2 — a floor item with no source content silently becomes nothing.** Slot 5 is *budget*: it is in
ESCO's essential 20, it is in `tailoring-reasoning.md`'s shared baseline, it is in 7 of 17 adverts, and
Manulife states it (*"staying within budget"*). **His CV has no budget bullet.** The rule has no answer
for a floor item the person cannot evidence — it just fails to fill the slot, silently, which is
precisely the shape ADR-0004 clause 1a calls a defect and ADR-0007 clause 1 calls a removal that must be
explained. **A floor is only useful if a miss is visible.**

**Break 3 — the rule produces an interchangeable CV.** Against a generic advert, following the rule
strictly gives four floor bullets any senior PM could write. His six years of banking-product delivery
compete for whatever is left. **The rule optimises for looking qualified and against looking
distinctive**, and every screener sees the same eight lines from every applicant.

**Break 4 — the rule cannot run, because nothing can classify.** Every step above required a human to
read a sentence and decide *"this is floor"* or *"this is a discriminator"*. **The pipeline has no field
that records it** (`candidateClaims.ts:31`), no prompt that asks for it, and no lint that checks it.

### Posting B — Computershare, Business Readiness Senior Project Manager, Hong Kong

The same 15 bullets, a different advert, and the classification **inverts**. Computershare states:
*"leading end-to-end business readiness for a high-profile initiative to build and launch a new mobile
app"* · *"ensure the business is fully prepared to support go-live across regulatory, legal, operational
and client-facing environments"* · *"drive readiness planning, governance, documentation, reporting and
decision-making"* · *"Accountable for local regulatory execution such as ICP and app registration"*.

Now **A5 (mobile-banking PIN-code authentication)**, **A7 (self-service card activation)** and **A2
(card services into digital banking)** are no longer decoration — they are the strongest evidence on the
CV, and **merging them into one line would be the worst possible move**, because each carries a distinct
piece of exactly what this advert asks for. The merge that was correct against Manulife is wrong against
Computershare, using identical source material.

**This is the finding that settles the owner's question. A ratio is not merely hard to pick — it is the
wrong kind of object. The floor/discriminator boundary moves per advert, so any fixed N:M is guaranteed
to be wrong for some adverts, and there is no N:M that is right for both of these two.**

### The rule that survives, stated honestly

Not *N and M*. Something closer to:

1. **Every advert requirement that the person can evidence gets at least one bullet.** This is
   *coverage*, it is what Jobscan, Huntr, career-ops and ai-job-search all implement, **and we already
   compute it** — `judgedScore` over `card-judge.md`'s per-requirement verdicts. **Nothing new is needed
   to know which bullets earn a slot against this advert.**
2. **Floor items the advert does not state get *one* bullet each, and merging is how they fit.** D3+D5
   into one line is the mechanism, and it is already in rule 8.
3. **Everything left over goes to the strongest distinctive evidence, not to more floor.**
4. **A floor item nobody can evidence is reported, never silently skipped.**

**Steps 1, 2 and 4 are mechanical.** Step 1 runs on verdicts we already produce. Step 2 needs the floor
list, which is offline family research, not per-user judgement. Step 4 is a lint.

**Only one thing is irreducibly a model's job, and it is not the arithmetic:** deciding, for *this*
sentence against *this* advert, whether it is floor or discriminator — and, when merging, deciding what
may be fused without losing an outcome. **That is judgement, it is per-advert, and it cannot be
precomputed or tabulated. The owner is right. He is right about a smaller and more specific thing than
he thought, and the rest of the problem is a rule he can have.**

---

## What remains open

**1. The family floor does not exist and the pointer to its shape is broken.** `tailoring-reasoning.md`
cites `onboarding-reward-design.md` §6.2; **§6 has no subsections**. The nearest real contract is §13's
*"in ranked order, each item's importance band, fast question, answer options, destination CV section,
and whether a negative is fatal or acceptable"* — a **question** contract. **Somebody has to write the
CV-content contract, and it is not the same document.** Fixing the dangling pointer costs minutes and
prevents the next session building on §6 as though it answered §4.

**2. Whether the 17-advert corpus is representative.** The excerpts are truncated at 2,200 characters,
which usually cuts the *Requirements* block. **Every count in finding 1 is a lower bound.** Re-running
those counts against full advert text is an afternoon's work and it is the cheapest experiment this
document can recommend — because if Agile turns out to be in 14 of 17 full adverts, finding 1 collapses
and §4's justification stands.

**3. Lightcast's per-occupation skill ranking.** It is the only source that would produce a floor
**derived from adverts** rather than from expert opinion, and it is behind a commercial contract. If a
build ticket needs a defensible rank, that is where to buy it.

**4. Whether O\*NET's Relevance column would rank a floor usefully.** `RT` genuinely spreads (65.6%–100%
for the nearest rated occupation) where `IM` does not. **But 13-1082.00 has no ratings at all**, so this
would have to be done against a proxy occupation, and the proxy choice is itself a judgement.

**5. Whether a compound merged bullet is read differently from four separate ones.** No evidence at any
quality level. This is the single most testable thing in the document and nobody has tested it.

**6. What happens to `preview-tailor.md` rule 8 and the outcome-led rule.** They conflict (Q4) and
nothing arbitrates. This needs a decision regardless of what happens to the floor.

**7. HireAbility, Affinda, Kickresume and Careerflow** — unchecked for the same access reasons the
sibling document records. Recorded as unchecked, not as negative.

## What this research cannot settle

**It cannot tell you the right mix, because nothing measures it.** Not a study, not a dataset, not a
vendor. Every source that expresses a preference for achievements over duties is expressing a preference
about **phrasing** — the same five banned openers, over and over — and none has anything to say about
proportion. **Whatever number ends up in a prompt will be a design opinion, and it should be written
down as one rather than dressed as a finding.**

**It cannot make the classification problem go away by improving the rule.** The floor/discriminator
boundary is a property of the **advert × sentence** pair, not of the sentence. Posting A and Posting B
sort his identical 15 bullets differently. No table, ratio or threshold survives that.

**And it cannot validate the cap it was asked to work within.** The 8 is not in the research this repo
cites for it, no external source supports any per-role bullet cap, and the best available study of CV
length found recruiters preferring **more** content, most strongly for managerial roles. **The question
was "how do we split 8?" The honest answer includes "check whether it should be 8."**

---

## Sources, with liveness

**Read directly at source — datasets**

- **ESCO API**, occupation `ICT project manager`, ISCO 1330.7 — `hasEssentialSkill` (20),
  `hasOptionalSkill` (40), fetched live and enumerated.
  `https://ec.europa.eu/esco/api/resource/occupation?uri=http://data.europa.eu/esco/occupation/8b6388a4-4904-471b-9331-d3b1211f5525&language=en`
- **ESCOpedia — *Essential*** (definition quoted verbatim).
  https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/essential
- **ESCO — Occupations** (data-model description).
  https://esco.ec.europa.eu/en/classification/occupation_main
- **O\*NET 30.3 public database** — `Task Statements.txt`, `Task Ratings.txt`, `Work Activities.txt`,
  `Scales Reference.txt`, `Content Model Reference.txt`, downloaded (no registration) and computed over
  first-hand. Site updated 2026-07-14. https://www.onetcenter.org/database.html
- **O\*NET OnLine — 13-1082.00 Project Management Specialists** (20 unrated tasks).
  https://www.onetonline.org/link/details/13-1082.00
- **SFIA 9 — PRMG Project management** (definition, levels 4–6).
  https://sfia-online.org/en/sfia-9/skills/project-management
- **e-CF / EN 16234-1** — 41 competences, E.2 Project and Portfolio Management, and the framework's own
  statement that a competence *"does not represent the complete content of a 'Project Manager's' job
  role"*. https://itprofessionalism.org/professionalism/e-competence-framework/ ·
  http://appcert.eu/e-2-project-and-portfolio-management/
- **Lightcast Open Skills — FAQs** (skill definition, taxonomy provenance, *"API access is now available
  on a contract basis"*). https://lightcast.io/open-skills/faqs

**Read directly at source — shipped products and code**

- **santifer/career-ops** (63k★) — `modes/pdf.md`, `modes/latex.md`, `modes/_writing.md`,
  `modes/heuristics/recruiter-side.md`, read via the GitHub API.
  https://github.com/santifer/career-ops
- **MadsLorentzen/ai-job-search** (30k★) — `CLAUDE.md`, read via the GitHub API.
  https://github.com/MadsLorentzen/ai-job-search
- **srbhr/Resume-Matcher** (28k★) — `apps/backend/app/prompts/enrichment.py`, read via the GitHub API.
  https://github.com/srbhr/Resume-Matcher
- **Rezi — *The Rezi Score Explained*** (3–6 bullets per entry; 400–1600 words; one to two pages).
  https://www.rezi.ai/rezi-docs/the-rezi-score-explained
- **Textkernel Tx v10 candidate data model** — skill `FoundIn`, anchored to `exp_n` / `edu_n`, never to a
  sentence. https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
- **Huntr** — Resume Tailor and Resume Keyword Scanner product pages (five keyword types).
  https://huntr.co/product/resume-tailor · https://huntr.co/product/resume-keyword-scanner
- **Teal** — Resume Builder product page and Teal's own posted tailoring tutorial (achievement toggles,
  Match Score). https://www.tealhq.com/tools/resume-builder

**Studies, with their stated methods**

- **Frontiers in Sociology (2024), *What do eye movements say about the choices recruiters make?*** —
  40 recruiters, 10 fictitious CVs, six areas of interest, *experience* undivided.
  https://www.frontiersin.org/journals/sociology/articles/10.3389/fsoc.2024.1222850/full
- **ResumeGo (2018), *Settling the Debate: One or Two Page Resumes*** — 482 recruiters, 7,712 selections,
  2.3× two-page preference (2.9× managerial), 350–500 vs 700–850 words, 2m24s vs 4m5s read time.
  ⚠️ Company with a commercial interest in the result. https://www.resumego.net/research/one-or-two-page-resumes/
- **Ladders (2018) eye-tracking, 7.4 seconds** — ⚠️ **PDF returned HTTP 403 to automated fetch**; method
  and criticisms taken from contemporaneous trade reporting and the company's own release. n≈30,
  never peer-reviewed, full method never published.
  https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/ ·
  https://www.prnewswire.com/news-releases/ladders-updates-popular-recruiter-eye-tracking-study-with-new-key-insights-on-how-job-seekers-can-improve-their-resumes-300744217.html

**Institutional guidance**

- **Purdue OWL — Work Experience Section**: *"a minimum of three bulleted items with the most relevant
  duties listed first"*; bullets detail *"duties you performed"*.
  https://owl.purdue.edu/owl/job_search_writing/resumes_and_vitas/resume_sections/work_experience_section.html
- **APM — 10 tips for writing a winning project management CV** (content prompts, no counts).
  https://www.apm.org.uk/jobs-and-careers/tips-for-writing-a-winning-cv/

**Behind a wall or otherwise unreadable — recorded as unchecked, not as negative**

- **Jobscan support, *How is the resume match rate calculated?*** — redirects to a landing page for
  automated fetch; both quotes come from search-engine indexing of the article.
  https://support.jobscan.co/hc/en-us/articles/360055995534-How-is-the-resume-match-rate-calculated
- **Teal help centre** — HTTP 403. **Ladders study PDF** — HTTP 403. **MDPI eye-tracking/ML paper** —
  HTTP 403. **Kessler, Low & Sullivan, *Incentivized Resume Rating*** — PDF would not render to text.
  **European ICT Professional Role Profiles page** — HTTP 404. **Lightcast per-occupation skill
  rankings** — commercial contract. **LinkedIn Skills taxonomy** — partner-restricted. **PMI CV
  guidance** — member access. **Kickresume / Careerflow selection logic** — no documentation found.

**This repo — read, not assumed**

- `docs/cv-brain/tailoring-reasoning.md` §3 (39-45), **§4 (53-88)**, §6 (99-106)
- `docs/cv-brain/cv-authoring-rules.md` (19-23, 45-46, 83-89, 127) and
  `docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md` (5, 6, 39, 82-85, 190)
- `docs/onboarding-reward-design.md` §5 (135-137), **§6 (161-189)**, §7 (197), §13 (340-341)
- `apps/api/prompts/preview-tailor.md` rules 4-8 (32-47), `apps/api/prompts/card-judge.md`
- `apps/api/src/preview.ts` — Draft (105-139, cap at **117**), `conservationIssues()` (187-230, floor at
  **219**)
- `apps/api/src/judge.ts` — `buildJudgeInput()` (66-74); `apps/api/src/eligibilityDiscovery.ts:128`
  (`ASK_DIMENSIONS`)
- `packages/contracts/src/candidateClaims.ts:31` (`role` is the only structural slot)
- `apps/api/data/sample-postings.json` (17 adverts, counted); `data/cvs/ADRIEN MOUNIER SENIOR PROJECT
  MANAGER CV 2026.pdf` (re-extracted via `apps/api/src/extract.ts:28-45` and measured)

**Prior research this builds on (do not re-derive)**

- [`work-projects-inside-a-job.md`](work-projects-inside-a-job.md) — the `Project Achievements` heading
  is a **label over a second bullet list**; the judge sees a flat fact list with no grouping; the Draft
  caps a role at 8 bullets.
- [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
  · [`cv-summary-structure-and-length.md`](cv-summary-structure-and-length.md) ·
  [`eligibility-dimensions-from-the-corpus.md`](eligibility-dimensions-from-the-corpus.md).
