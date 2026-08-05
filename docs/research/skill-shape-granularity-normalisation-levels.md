# How a skill should be shaped — granularity, normalisation, and whether a level survives at forty

_Deep-sources half of the research for [#145](https://github.com/adrien-mounier/jobcrush-app/issues/145),
under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127). Blocks
[#140](https://github.com/adrien-mounier/jobcrush-app/issues/140). Written 2026-08-05._

_A `/last30days` companion covers recent movement. This half covers established, high-trust primary
sources: shipped API documentation, published schemas, peer-reviewed papers with numbers._

**What this document is not.** It does not repeat
[`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md), which surveyed what
schemas *define*. This one asks what production systems *do*, and what the failure modes cost. Where
the two overlap I say so and move on.

---

## Bottom line

**The evidence supports (c) — but (c) is cheaper than the session priced it, and one of its three
options was never really on the table.**

**1. The shipped shape is one skill record with two fields, not two records.** The two biggest CV
parsers in the market — Textkernel and RChilli — both ship exactly this and have for years. A skill
carries **the raw words as written** and, when it resolves, **a normalised code**. Same record. So
(c)'s stated cost — *"every skill exists twice; every screen must know which to show"* — is mostly an
artefact of how the fork was written. There is one skill; it has a verbatim side and a resolved side,
and the resolved side is simply empty when nothing matched. **That is ADR-0003 clause 2 unchanged**,
and the session's instinct was right.

**2. The verbatim line is not a skill.** It is the sentence, and ADR-0001 rule 3 already keeps it.
Adrien's *"Prompt engineering: structured prompting, Chain-of-Thought, …"* becomes six skills, each
pointing at the exact stretch of text inside that line that produced it. The line itself stays where
it always was. Nothing needs to exist twice for that to work.

**3. The real cost, which the session did not name, is that the unresolved half does not match.**
Textkernel states it plainly in its own documentation: its scoring algorithms *"ignore raw skills and
only consider the normalized skill concepts."* So a skill we cannot resolve is stored, shown and
printed — but it is invisible to matching. That is the honest price. It is the price ADR-0003 clause 2
already accepted for organisations (*"an unresolved name … merely does not group"*), so it is a known
price, not a new one.

**4. The single most valuable thing found: there is a shipped pattern that makes silent upgrade
detectable, and it is character-level.** Textkernel's live Skills API returns, for every normalised
skill, a **confidence score 0–1**, a tunable **threshold** (default 0.5), and a **`Matches` array
containing the exact substring** of the document that evidenced it, with start and end positions. A
normalised term that no substring produced cannot exist. Alibaba's production HR platform runs the
blunt version of the same rule: **discard any extracted record whose key fields cannot be found in the
original document text.** This is the requirement from owner decision 9 — *the machine never adds
silently* — already solved, in production, by other people. **Adopt it.**

**5. And the counter-evidence matters: the biggest players do the thing you have forbidden.** Workday
infers skills and LinkedIn infers skills, and neither publishes a provenance marker, a confidence
score, or a confirmation step on the inferred skill. Workday's own engineering write-up on skill
inference does not mention any of the three. So the honest read is: **the pattern you need exists at
the parser layer and is absent at the platform layer.** You are copying Textkernel, not Workday.

**6. Do not ask for a proficiency level per skill.** Not one system was found that collects
self-assessed proficiency across 40+ skills. The strongest available evidence on self-assessment —
22 meta-analyses, over 330,000 people — puts the correlation between self-rated ability and measured
performance at **r = .29**, about 8% shared variance. LinkedIn tried the objective alternative, ran it
for four years and **killed it**; its stated replacement is *"connect their skills to specific jobs,
projects or education"* — which is exactly the mention-site our corpus already gives away free.
Shipped practice is to **derive** a level (years, recency, how many jobs mention it) or to **capture a
level only when the CV already states one** — never to ask.

**7. Q4 and Q5 are one decision, not two, and the answer is already in the corpus.** Textkernel ships
`FoundIn` (which jobs a skill was found in) and derives `LastUsed` **from it** — *"inferred from the
work history"*. Nobody asks a candidate when they last used a skill; everybody computes it from where
the skill appeared. Remy's `(Splunk, Control-M, Bash, Linux)` on his 2023–2025 Amundi job is,
verbatim, the input those systems use.

**8. Q6 is genuinely unprecedented.** Nothing anywhere models *"the machine proposed it, the human
approved it, here is the interview narrative that defends it."* Every shipped system collapses an
accepted suggestion into an ordinary skill with no trace. That is the same category as ADR-0003
clause 7 (supersession): ours to design, no prior art to copy, and the absence is a real cost to plan
for rather than a gap to fill by searching harder.

**What this costs, in plain terms.** Storing a span and a confidence per skill is small — a few extra
fields on a record you are creating anyway. The expensive parts are the two you would be adding by
choice: a review screen where the person sees *"you wrote JS, we're calling it JavaScript"* and can say
no, and the discipline that a skill with no span is a bug, not a feature. Skip the proficiency
question entirely and #140 gets smaller, not bigger.

---

## Q1 — Granularity: does anyone store both levels, and what does it cost?

### Yes. Two of the largest CV parsers ship it, and it is not experimental.

**Textkernel** (Tx Platform v10, live; the parser behind a large share of European and US ATS
installations) splits skills four ways — `IT`, `Soft`, `Professional`, `Language` — and for each
non-language skill stores:

- the skill **as raw text**, *"as extracted from the document"* (field `Skill`);
- and, with the Skills Classification add-on, **`SkillCode` / `SkillDescription`** — the same skill
  normalised to the Textkernel Skills Taxonomy.

Its own summary: *"Professional skills are extracted from the document as raw text (field `Skill`),
and additionally include the list of extracted professional skills normalized to the Textkernel Skills
Taxonomy (fields `SkillCode` and `SkillDescription`)."*

**RChilli** (live, v8 docs, active release notes) ships the same two-level object under
`SegregatedSkill`, with eight fields: `Skill` (as extracted), `FormattedName` (the normalised form),
`Alias` (taxonomy synonyms), `Ontology` (the broader category), `Type`, `Evidence`, `LastUsed`,
`ExperienceInMonths`. When taxonomy is not requested, `Ontology`, `Alias` and `FormattedName` come back
empty and the raw `Skill` still does.

**HR Open's `competencyName` alongside `competencyIds`/`taxonomyIds`** (the schema-only design flagged
in #138) is therefore not merely schema-only in spirit — the *pattern* is shipped, twice, by vendors
who process CVs at industrial volume. What remains unverifiable is whether anyone implements HR Open's
specific field names; HR Open publishes no implementers list, and I could not find one.

### What it costs them — the answer is documented, and it is not what the session guessed

The session priced (c) as *"every skill exists twice; every screen must know which to show."* That is
not the shipped cost, because it is not two records. The shipped cost is stated by Textkernel itself,
in the indexing documentation:

> *"Skills Normalization must be included to index documents using V2 Skills Taxonomy. These
> algorithms ignore raw skills and only consider the normalized skill concepts for skills category
> scoring."*
>
> *"This leads to improved scoring and ranking because normalization produces less false negatives
> than simple exact keyword matching."*

**So: the raw side is for display and for not losing anything; the normalised side is for matching.
A skill that fails to normalise is stored and shown but does not participate in scoring.** Their
documentation does not say what happens to unnormalisable skills beyond that — I checked, and it is
simply not addressed.

That is the honest cost, and it is a cost this repo has already accepted once. ADR-0003 clause 2 says
an unresolved organisation name *"is still stored, still shown, still printed — it merely does not
group."* Substitute "does not match" for "does not group" and it is the same clause.

### Is there a documented case of the two-level design failing or being abandoned?

**No — and I looked.** I searched specifically for engineering write-ups describing abandoning a skills
taxonomy, dropping normalisation, or moving to pure embeddings instead, and found none. LinkedIn's own
engineering post on its Skills Graph (March 2023) describes the taxonomy **growing** — nearly 39,000
skills, 374,000 aliases across 26 locales, 200,000+ edges, up 35% since February 2021. The direction of
travel in public is uniformly toward more normalisation, not less.

**A caveat on what that absence proves:** companies do not publish their retreats. Absence of a public
post-mortem is weak evidence of absence of a failure. What I can say positively is that the two
vendors who ship the two-level design still ship it, and one of them updates its synonym lists **every
two weeks** and its taxonomy structure **quarterly** — which is what active maintenance looks like, not
what a deprecated feature looks like.

### The one thing that changes the shape of the decision

Our corpus has **two different duplication problems**, and they need two different mechanisms. The
fork treated them as one:

| Corpus case | What it needs | Difficulty |
|---|---|---|
| `JS` / `JavaScript` / `Javascript` in one document; `C#` five times across four jobs | **Alias lookup.** Textkernel carries ~250,000 synonyms for ~13,000 skills; RChilli returns an `Alias` field. | **Easy and solved.** This is a dictionary, not a model. |
| *"Responsible AI usage in regulated environments (data sensitivity, tool selection)"* → a taxonomy concept | **Entity linking.** | **Unsolved — see Q2.** Best published top-1 accuracy on the comparable task is 23.55%. |

**#86's escalation — the intra-CV duplication found on 2026-08-04 — is the easy half.** Remy's three
spellings of JavaScript and five mentions of C# are proper nouns with published aliases. They do not
need an LLM and they do not carry the silent-upgrade risk. The risky half is the prose line, and the
right answer for the prose line is *not to atomise it at all* — which is exactly what (b) alone could
not do, and why the session rejected (b).

---

## Q2 — Normalisation, honestly: is there a shipped pattern that makes silent upgrade detectable?

**This is the most important question in the ticket and the answer is yes, with a named, live,
documented implementation.**

### The pattern: anchor every normalised term to a span of the source document

Textkernel's **Extract Skills** API (Tx Platform v10, live) returns, per extracted skill:

| Field | Documentation, verbatim |
|---|---|
| `Id` | *"The ID for the skill in the skills taxonomy."* |
| `Description` | *"The description of the normalized skill concept in the requested language."* |
| `Confidence` | *"A value from [0 - 1] indicating the overall confidence that the extracted term actually refers to a skill in the context of the text."* |
| `Matches[]` | array of `BeginSpan`, `EndSpan`, `Likelihood`, and **`RawText`** — *"The actual term that was found as evidence of this skill (the substring from BeginSpan to EndSpan)."* |
| `Type` | *"Possible values are `Certification`, `Professional`, `IT`, `Language`, or `Soft`."* |

And a request parameter:

| Parameter | Documentation, verbatim |
|---|---|
| `Threshold` | *"A value from [0 - 1] for the minimum confidence threshold for extracted skills."* Default **0.5**; lower values return more skills *"with increased ambiguity risk."* |

**Why this answers owner decision 9 directly.** A normalised skill in this design cannot exist without
a substring of the candidate's own document that produced it. So the failure the map is worried about —
*"normalized to a title or skill the candidate never claimed"* — is not merely forbidden by policy, it
is **structurally visible**: you can put the person's own words next to the term we assigned, on one
line, and ask. *"You wrote `JS`. We're filing this as JavaScript."* The confirmation screen writes
itself from the span.

It also gives a mechanical bug test, which policy alone never does: **a skill with no span is a
defect.** That is checkable in code, in a test, on every parse — the same class of mechanical
enforcement as `conservationIssues()`.

### The blunt version of the same idea, running in production at scale

Alibaba's intelligent HR platform (CaiMi) runs a step it calls **source text verification**:

> *"we perform a verification step for every extracted record, discarding any entity whose key
> identifying fields (e.g., company name and job title) cannot be found in the original document text,
> thereby pruning model hallucinations."*

Deployment is stated: 240–300 résumés per minute, 1.54-second latency. Reported extraction quality:
F1 = 0.964 / accuracy = 0.961 on **RealResume** (13,100 samples, 13,000 train / 100 test) with a
fine-tuned 0.6B model; F1 = 0.959 with a Claude-4-based pipeline. On **SynthResume** (2,994 samples,
2,500 train / 494 test): F1 = 0.917 and 0.946 respectively.

**Read those numbers carefully before reusing them.** They cover *Basic Information, Work Experience,
Education Background and Project Experience*. **The paper does not evaluate skill extraction at all.**
It is strong evidence for the *mechanism* (grounding extraction in the source string is a shipped,
scaled practice) and **no evidence at all** for how well skills specifically survive it. The paper is
on arXiv (2510.09722), not peer-reviewed.

### A third, weaker variant: section-level rather than character-level

RChilli's `SegregatedSkill.Evidence` records *where in the résumé* a skill was found — values like
`ExperienceSection`, `ProjectSection`, `SkillSection`. That is coarser than a character span: it tells
you which region produced the skill but not which words. Enough for an audit trail, not enough to
render the confirmation sentence.

### Now the bad news: how accurate is normalisation, really?

The strongest published number on the comparable task — and it is worse than #138's F1@5 = 0.72
suggests:

**Zhang, van der Goot & Plank, "Entity Linking in the Job Market Domain", EACL 2024 Findings**
(peer-reviewed). Task: link **fine-grained span-level skill mentions** to ESCO. Benchmark: **1,824
human-annotated test mentions** from real job advertisements (455 unique skill titles, 813 unknown
labels), built on Decorte et al. (2022).

| Model (mention-level, no re-ranker) | acc@1 | acc@4 | acc@16 | acc@32 | MRR |
|---|---|---|---|---|---|
| BLINK (bert-large, Wiki + ESCO) | **23.55%** | 32.63% | 43.25% | 48.98% | 28.8 |
| GENRE (bart-large, Wiki + ESCO) | 11.48% | 21.26% | 37.21% | 49.78% | 17.5 |

For contrast, earlier **sentence-level** work (a coarser, easier task): Decorte et al. 2023 MRR 47.8
with SentenceBERT; Clavié & Soulié 2023 MRR 51.6 with GPT-4.

**Three things must be said about these numbers before anyone uses them:**

1. **The authors themselves flag the evaluation as harsh.** They note predictions that are
   *"technically correct"* but *"falsely penalized"* because only one gold ESCO label is accepted where
   several would validly match. True accuracy is higher than 23.55%. How much higher is not quantified.
2. **The corpus is job advertisements, not CVs.** Ad prose (*"experience coordinating cross-functional
   delivery"*) is harder to link than a CV's parenthetical `(C#, XrmToolBox, Git)`.
3. **This is linking to ESCO's ~13,500 concepts.** A smaller, tool-focused vocabulary is an easier
   target.

**But the direction is unambiguous, and it is the direction that matters here: at the fine-grained
mention level, the single top guess is frequently wrong.** Any design that takes the top-1 normalised
term and writes it into the person's record without them seeing it will be wrong often enough to
matter. That is the empirical case for the confirmation screen, independent of the philosophical one.

### What the platform layer does — and it is not this

Two of the largest skills platforms in the world infer skills, and **neither documents the safeguards
above**:

- **Workday Skills Cloud** captures skills from three routes — self-declared, AI-inferred, and
  manager-validated/endorsed. Workday's own engineering write-up on its LLM-based skill inference
  service (*Skill Inference: Building an LLM-based Service in the Workday Skills Cloud*, Elinor
  Brondwine and Scott Johnson, 13 February 2025) **does not describe a provenance marker on the
  inferred skill, does not describe a confidence score or threshold, does not describe a user
  confirmation step, and does not address the risk of inferring a skill the person never claimed.**
  Those are absences in the published text, not proof the product lacks them — but the omissions are
  conspicuous in an engineering post whose whole subject is the inference service.
- **LinkedIn** infers skills by taxonomy relation: *"if a member lists 'Supply Chain Automation' as a
  skill … we can infer that this member knows something about the parent skill 'Supply Chain
  Engineering.'"* The post does not describe how inferred skills are marked, confirmed or displayed.

**This is the finding that should reassure the owner about the strictness of decision 9: it is not
industry-standard, it is stricter than industry-standard, and the shipped machinery to honour it exists
one layer down at the parser.**

---

## Q3 — Levels at volume: does anyone collect self-assessed proficiency across 40+ skills?

### Short answer: no system was found that does this, and the field's biggest attempt was withdrawn.

### What LinkedIn did, and what it said when it stopped

LinkedIn Skill Assessments launched in September 2019, were discontinued in late 2023, and **all
badges and associated assessment data were removed from member profiles in 2024**. LinkedIn's own help
page states the reason and the replacement:

> *"hirers that examples of how a candidate applied their skills is increasingly valuable to assess
> fit"* — and members should instead *"tag a skill to any credentials obtained and connect their
> skills to specific jobs, projects or education directly on their Profile."*

Note what LinkedIn replaced a **measured** proficiency signal with: **not a self-rated level, but a
mention-site.** The largest career platform on earth ran an objective skill-level programme for four
years, cancelled it, and replaced it with *where you used the skill*. That is Q4's answer arriving
inside Q3's.

(Secondary reporting also attributes the withdrawal partly to fraud — proxy test-taking and answer
leakage. LinkedIn does not say this itself, so treat it as unconfirmed.)

### The evidence on self-assessment quality — with provenance

| Finding | Source, sample, year |
|---|---|
| Mean correlation between self-evaluations of ability and objective performance = **r = .29** (SD .11; individual meta-analytic effects ranged .09–.63) | **Zell & Krizan, "Do People Have Insight Into Their Abilities? A Metasynthesis", *Perspectives on Psychological Science*, 2014.** A metasynthesis of **22 meta-analyses**, data from **over 330,000 individuals**, across academic ability, intelligence, language competence, medical skills, sports and vocational skills. Peer-reviewed. |
| Same figure, independently: **r = .29** across **55 studies** | Mabe & West, *Journal of Applied Psychology*, 1982 — the classic self-evaluation-of-ability meta-analysis. |
| Self-estimated vs measured intelligence, **r = .33** across **41 studies** | Freund & Kasten meta-analysis (2012). |

**r = .29 means roughly 8% shared variance.** A self-assessed level is a weak signal, not a worthless
one — but weak enough that it should never gate a job, which is what #125 already decided for languages
and what ADR-0003 clause 8 already carries forward.

**One nuance in Zell & Krizan that cuts the other way and is worth keeping:** the correlation is
**stronger when self-evaluations are specific to a given domain rather than broad**, and when the
performance task is objective, familiar, or low in complexity. So *"how good are you at Splunk"* is a
better question than *"rate your technical ability"*. This is an argument for granularity in the
question — but not an argument for asking it forty times.

**The Dunning–Kruger literature should be cited carefully.** The classic interpretation is contested:
Gignac & Zajenkowski (*Intelligence*, 2020) argue the effect is *"(mostly) a statistical artefact"*
reproducible from the better-than-average effect plus regression to the mean, and Nuhfer et al. reach
a similar conclusion. **Do not build an argument on Dunning–Kruger.** The Zell & Krizan figure is the
defensible one, and it says what is needed anyway.

### Does anybody make per-skill proficiency work?

Four shipped approaches were checked. **None of them asks the person about 40+ skills.**

1. **Extract the level if the CV already states one; never ask.** Textkernel carries `Level` and
   `Years` on all four skill categories. Their documentation does not state where `Level` comes from —
   I looked specifically and it is unspecified — but the parser's job is reading a document, so it is
   a captured value, not an elicited one. RChilli does the same via `ExperienceInMonths`. **This is a
   free level for the minority of CVs that state one, at zero question cost.**
2. **Derive it.** RChilli's `ExperienceInMonths` and Textkernel's `Years` / `LastUsed` are computed
   from where the skill appears in the work history (see Q4/Q5). Duration and recency are a proxy for
   depth that requires no question at all.
3. **Put the ladder on the job, not the person.** Singapore's **SkillsFuture Skills Frameworks** define
   Technical Skills and Competencies at proficiency levels **1 (basic awareness) to 6 (expert)** — but
   the levels are attached to **occupations and job roles**, describing what a role requires, not what
   an individual self-rates. That is a materially different design and it is the one a government
   framework in our own market chose.
4. **Verify it, at cost.** Workday's *Skills Verification* / skill leveling / endorsements, and the
   whole assessment industry. Real, and completely out of scope for a product where nobody but the
   candidate is present.

### The standards position has moved slightly since #138 — worth knowing, does not change the answer

ADR-0003 clause 8 records that *"no interoperable skill scale exists (HR Open defines a container for a
scale and declines to define the scale)."* **That is still true, but HR Open is actively trying
again.** On **21 January 2026** the HR Open Skills Data Workgroup announced a **pre-release of a
"Skills Proficiency Data API Schema"**, described as *"the first-ever"* such open standard, *"designed
to support interoperability across HCM, assessment, learning, talent, and skills intelligence
platforms."*

**But:** the announcement names **no proficiency levels, no scale and no scoring framework**; it is
explicitly a **pre-release** open for comment *"before finalization"*; and it names **no implementers
or adopters**. So as of today it is still a container, and the clause-8 finding stands. It is worth
noting as **live movement** — unlike the dead standards #138 catalogued (JSON Resume archived
2026-06-12; ELM's repo archived 2024-02-14), this is a standards body actively working. Recheck in six
months before committing to any scale of our own.

### What this means for ADR-0003 clause 8's stress test

Clause 8 sent skills to ladder (a) — *ask him once* — and predicted that if it broke at forty, *"the
break is in ladder (a)'s trigger, not in its shape."* **The evidence says the prediction was right and
the break is real.** Nobody asks forty times. The trigger that survives is: **never ask; capture the
level if the CV states it; otherwise derive from years and recency.** Ladder (a)'s *shape* is untouched
and still correct for languages and degree level — its *ask-once trigger* simply does not scale to
skills, and #140 should say so explicitly rather than let clause 8's default routing carry it in.

---

## Q4 — Mention-sites: does anything model "which jobs a skill was used in"?

### Yes — and the ticket's framing understates it. No *standard* models it; the *production layer*
### models it universally.

| System | Field | What it holds | Liveness |
|---|---|---|---|
| **Textkernel** | `FoundIn` | *"a comma-separated list of Work History items Id's indicating where the skill was found"* — on all four skill categories | Live, Tx Platform v10 |
| **RChilli** | `Evidence` | Which résumé section produced the skill (`ExperienceSection`, `ProjectSection`, `SkillSection`) | Live, v8 |
| **Textkernel Skills API** | `Matches[].BeginSpan` / `EndSpan` | Character-level position in the source text | Live, v10 |
| **LinkedIn** | skills attached to individual positions in the Experience section | The member links each position to the skills used in it | Live — and this is the **stated replacement** for retired Skill Assessments |

**This is the strongest convergence in the whole document.** Three independent shipped systems — two
parsers and the largest career platform — all decided that *where a skill was used* is worth storing
per skill. And LinkedIn did not just add it; it made it the answer to *"how do we know this person can
actually do this"* after cancelling the alternative.

### What it is used for

- **Deriving recency.** Directly and explicitly — see Q5.
- **Deriving duration.** RChilli's `ExperienceInMonths` and Textkernel's `Years` need a mention-site to
  be computable at all.
- **Recruiter context.** LinkedIn's stated purpose is that hirers want *"examples of how a candidate
  applied their skills."*
- **Confidence — not documented anywhere.** I found no system that publishes using mention-count or
  mention-site as a confidence input to matching. If we do it, we are ahead of the documented field,
  not behind it.

### For our corpus, this is free and it is already there

Remy's `(Splunk, Control-M, Bash, Linux)` sits on Amundi Singapore, 2023–2025. `(SQL Server, Power BI,
VBA, Python)` sits on another job with its own dates. **The parenthetical-inside-a-bullet pattern that
made #145 look hard is, in the shipped world, the ideal input**: it is an atomic skill list already
attached to a dated employer. The systems above have to work to recover what our corpus hands over
directly.

**The corrective to the repo's belief:** #145 Q4 says this is *"the thing our corpus hands us for free
and no surveyed standard models."* Half right. No *standard* models it — HR Open, JSON Resume, ELM and
schema.org all lack it, exactly as #138 found. But `foundIn` was already flagged in
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
as *"one design detail worth stealing"*, and it turns out to be not a Textkernel quirk but the
production-layer consensus. **We would not be inventing this. We would be adopting it.**

---

## Q5 — Recency: is `lastUsedDate` a field nobody fills?

### No. It is a field nobody *asks* for and everybody *computes*.

Textkernel's documentation is unambiguous, and this is the single most useful sentence in this section:

> `LastUsed` — *"the date the skill was last used … **inferred from the work history**, in the format
> `YYYY-MM-DD` or the placeholder `__NOWSTRING__` if the skill is used in the current ongoing job held
> by the candidate."*

RChilli ships `LastUsed` on the same object. HR Open defines `lastUsedDate` on both its skill models
(`PersonCompetencyType` and TCP `SkillType`) — as #138 found, and as no other standard does.

**So the answer to Q5 is that Q5 is not a separate decision.** Recency is not a fact you collect; it is
a derivation from the mention-site. Store `FoundIn` and recency falls out of the job's dates —
including, neatly, ADR-0003 clause 5's stored precision: a skill found only on a job dated *2013* has a
last-used date known to the year, and clause 5 already says how to hold that without padding.

Textkernel's `__NOWSTRING__` placeholder is also worth stealing directly: it is ADR-0003 clause 6's
*"still there"* state applied to a skill rather than a job — a sentinel meaning *ongoing*, distinct
from both a date and a blank.

### Is recency actually used in matching or by recruiters?

**Here the evidence is weak, and I am flagging it rather than dressing it up.**

- Textkernel computes `LastUsed` but its indexing documentation, which does describe how normalised
  skills feed scoring, **does not say recency feeds scoring**.
- I found **no evidence of a "skill last used" filter in LinkedIn Recruiter**.
- The claim that *"a skill used in your current role continuously over four years scores substantially
  higher than the same skill listed in a role from seven years ago that lasted six months"* comes from
  **resumeoptimizerpro.com**, a site that sells resume-optimisation tools. **It cites no source, no
  study, no sample and no year for that specific claim.** Do not repeat it.

**Honest position: recency is universally computed and its downstream use is undocumented.** It costs
us nothing (it is a derivation, not a question), so capture it — but do not build a matching feature on
an assumption that employers weight it, because that assumption currently has no source behind it.

---

## Q6 — The stretch surface: any prior art for claimed / extracted / proposed-and-approved?

### Thin, exactly as the brief predicted. Here is precisely how thin, and what I checked.

**Three-way source provenance exists and is now industry-standard vocabulary:**

- **Workday Skills Cloud** captures skills via **self-declared**, **AI-inferred**, and
  **manager-validated / endorsed** routes, and separately maintains **Skill Interests** — *skills the
  worker would like to have*, kept apart from skills they do have, and used to drive learning
  recommendations.
- **HireVue** (industry vendor, 15 July 2025) codifies the same three: *inferred* (*"suggested by AI
  based on data from millions of resumes and job descriptions"* — *"speculative, not definitive"*),
  *self-reported* (*"skills that a candidate has explicitly said they have based on experience"* —
  *"descriptive, not predictive"*), *validated* (*"backed by evidence … tested through structured
  interviews, job simulations, skills assessments, or verified credentials"*). It provides **no
  guidance on how systems should mark or distinguish these**, and **no numbers**.
- **HR Open `PersonCompetencyType`** carries `interestLevel` alongside `proficiencyLevel` — interest as
  a separate axis from ability, which is the aspiration/possession split in schema form.
- **W3C Verifiable Credentials / Open Badges 3.0** distinguish a self-asserted *claim* from an
  issuer-asserted *credential* — a two-party provenance model.

**What none of them has:** a state meaning *the machine proposed this, the human looked at it and
approved it, and here is the interview narrative that defends it.* Workday's *Skill Interests* is the
nearest neighbour and it is about **wanting to learn**, not about **claiming with support**. Nothing
found holds a stretch and its defence together.

**And the failure mode you care about is the shipped default.** In every system checked, an accepted
suggestion becomes an ordinary skill. LinkedIn suggests skills and the member accepts; Workday infers
skills and the worker keeps them; neither documents any marker that survives acceptance. **The exact
thing owner decision 9 forbids — a stretch becoming indistinguishable from a claim — is what the
industry ships by default.**

**Verdict: this is ours to design, and it belongs in the same bucket as ADR-0003 clause 7.** Clause 7
notes that *"the research found no standard anywhere models supersession or when-we-learned-it"* and
designs it anyway. Q6 is the second entry on that list. The good news is that the mechanism from Q2
gives it to you nearly free: a skill whose span is empty is, by construction, a skill that came from
somewhere other than the CV. **A stretch is a skill with no span.** That is not a new field; it is a
consequence of the field you were already going to add.

⚠️ One live constraint the map already knows about, unchanged by this research: an approved stretch
currently leaks onto adverts it was never made for
([#141](https://github.com/adrien-mounier/jobcrush-app/issues/141)). Nothing found here helps with
that; no surveyed system scopes a skill to the application it was proposed for.

---

## What I could not establish, and why

**1. Whether anyone implements HR Open's skill fields in production.** HR Open publishes no
implementers list and its work-in-progress repositories are members-only. The *pattern*
(`competencyName` + `competencyIds`) is shipped by Textkernel and RChilli under different names; the
*standard* remains unverifiable from outside.

**2. Where Textkernel's skill `Level` value comes from.** The field exists on all four skill
categories. Their documentation states neither its source (extracted / inferred / normalised) nor its
scale. Only **language** skill levels are documented as normalised, to Textkernel's own Language Skill
Level classification. I checked the candidate data model page twice for this specifically.

**3. Lightcast's Open Skills extraction response schema.** Their public documentation is
JavaScript-rendered and returned only page shell to automated fetch (`docs.lightcast.dev/apis/skills`,
`lightcast.io/open-skills/extraction`). Secondary sources indicate a `confidence_threshold` parameter
exists, but **I could not read the response fields from a primary source and am not asserting them.**
If Lightcast matters to a decision, get an API key and read the response directly.

**4. Whether any resume parser besides Textkernel returns character-level spans.** Affinda and Daxtra
do not document span offsets publicly. RChilli documents `Evidence` at section granularity. Textkernel
is the only confirmed character-level implementation.

**5. Any completion-rate number for self-assessment across many skills.** I searched for enterprise
skills-profile completion rates and found only vendor guidance that participation is a known problem
and that short assessments complete better. **No usable percentage exists in public.** If someone
quotes you one, ask for the sample.

**6. Whether skill recency is used downstream by any employer, ATS or matching engine.** Universally
computed, use undocumented. See Q5.

**7. Precise per-skill accuracy of a modern LLM linking CV parentheticals to a taxonomy.** The
published benchmarks are on job-advertisement prose, not CV skill lists. **Our task is probably easier
than 23.55% top-1 suggests, and nobody has published how much easier.** This is the single number that
would most sharpen the design, and it does not exist. It would be cheap to generate ourselves against
the six-CV corpus.

**8. Whether the two-level design has ever been abandoned.** No public post-mortem found; see Q1.
Absence of published retreat is not proof of absence of retreat.

### Numbers I checked that turned out to be weaker than they look

- **"76.4% of recruiters filter candidates by skills before opening any resume."** Traces to
  **Jobscan, *The State of the Job Search 2025***. To Jobscan's credit the method **is** disclosed:
  *"Jobscan surveyed 384 recruiters in February–March 2025 using a random sampling of HR professionals
  who are directly involved in the hiring process. The survey was run through Zoho Surveys."* Also
  from it: *"over 99.7% of the 384 recruiters we surveyed use filters in their ATS or similar system."*
  **Qualify it, don't drop it:** n = 384, the sampling frame for "random sampling of HR professionals"
  is not defined, and Jobscan sells resume-optimisation software. Directionally useful; not a hard
  number.
- **The skill-recency scoring claim** on resumeoptimizerpro.com — **no source, no study, no sample,
  vendor site.** Unusable.
- **Dunning–Kruger as an argument against self-assessment** — contested as *"(mostly) a statistical
  artefact"* (Gignac & Zajenkowski, *Intelligence*, 2020). **Cite Zell & Krizan instead.**

---

## Sources, with liveness

**Live and actively maintained — safe to build against**

- **Textkernel Tx Platform v10** — current version. Skills taxonomy: *"more than 13,000 unique skills,
  encompassing over 250,000 skill synonyms spanning 20+ languages"*; *"more than 4500 unique
  professions … over 150,000 job title synonyms."* Update cadence: synonym lists **every two weeks**,
  taxonomy structure **quarterly**.
  - Candidate data model (skills, `FoundIn`, `LastUsed`, `Level`, `Years`): https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
  - Extract Skills API (`Confidence`, `Threshold`, `Matches[]` with `RawText`/`BeginSpan`/`EndSpan`): https://developer.textkernel.com/tx-platform/v10/skills-intelligence/skills-api/extract/
  - Index a Resume (raw-vs-normalised scoring statement): https://developer.textkernel.com/tx-platform/v10/search-match/document-management-api/index-resume/
  - FAQ (taxonomy size, update cadence): https://developer.textkernel.com/tx-platform/v10/faq/
- **RChilli** — live, v8, active release notes. `SegregatedSkill` = `Skill`, `Type`, `Evidence`,
  `ExperienceInMonth`, `LastUsed`, `FormattedName`, `Alias`, `Ontology`.
  - Parser fields: https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields
  - Release notes: https://docs.rchilli.com/resumeparser/v8/ReleaseNotes
- **ESCO** — live. v1.2 presented 21 May 2024; **v1.2.1 released December 2025**. ~13,500 knowledge,
  skills and competence concepts. Web-service API and local API both offered.
  https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/esco-versions
- **LinkedIn** — Skills Graph taxonomy live: ~39,000 skills, 374,000 aliases, 26 locales, 200,000+
  edges (as of March 2023). Skill Assessments **retired**; badges removed 2024.
  - Skills taxonomy engineering post (Macskássy, Jin, Lin, Wei, O'Neill, 21 March 2023): https://www.linkedin.com/blog/engineering/data/building-maintaining-the-skills-taxonomy-that-powers-linkedins-skills-graph
  - Skill Assessments retirement (LinkedIn Help, primary): https://www.linkedin.com/help/linkedin/answer/a1690529
  - Skills on individual experiences: https://www.linkedin.com/help/linkedin/answer/a593695
- **Workday Skills Cloud** — live. Skill Inference engineering post (Brondwine & Johnson, 13 February
  2025): https://medium.com/workday-engineering/skill-inference-building-an-llm-based-service-in-the-workday-skills-cloud-47c9cce9f7bd · Product: https://www.workday.com/en-us/products/human-capital-management/skills-cloud.html
- **SkillsFuture Singapore Skills Frameworks** — live, government-maintained. TSC proficiency levels
  1–6, attached to occupations. https://www.skillsfuture.gov.sg/initiatives/students/skills-framework · https://www.myskillsfuture.gov.sg/content/portal/en/career-resources/career-resources/education-career-personal-development/skills-framework.html

**Live but pre-release / unproven — do not commit to yet**

- **HR Open Standards** — 4.6 documentation updated **8 May 2026**; Trusted Career Profile released
  2026. **Skills Proficiency Data API Schema pre-released 21 January 2026** — a container, no named
  scale, no implementers.
  https://www.hropenstandards.org/news/hr-open-standards-announces-pre-release-of-the-first-ever-skills-proficiency-data-api-schema
- **Lightcast Open Skills** — live product; **public docs not machine-readable**, response schema
  unverified. https://lightcast.io/open-skills · https://docs.lightcast.dev/apis/skills

**Peer-reviewed**

- **Zhang, van der Goot & Plank, "Entity Linking in the Job Market Domain", Findings of EACL 2024.**
  1,824 human-annotated ESCO mention-links from job ads. BLINK acc@1 23.55%, MRR 28.8; GENRE acc@1
  11.48%, MRR 17.5. https://aclanthology.org/2024.findings-eacl.28/ · https://arxiv.org/abs/2401.17979
- **Zell & Krizan, "Do People Have Insight Into Their Abilities? A Metasynthesis", *Perspectives on
  Psychological Science*, 2014.** 22 meta-analyses, >330,000 individuals, mean r = .29 (SD .11).
  https://journals.sagepub.com/doi/abs/10.1177/1745691613518075 · https://pubmed.ncbi.nlm.nih.gov/26173249/
- **Mabe & West, "Validity of self-evaluation of ability: A review and meta-analysis", *Journal of
  Applied Psychology*, 1982.** 55 studies, r = .29.
- **Gignac & Zajenkowski, "The Dunning-Kruger effect is (mostly) a statistical artefact",
  *Intelligence*, 2020.** https://www.sciencedirect.com/science/article/abs/pii/S0160289620300271 · https://gwern.net/doc/iq/2020-gignac.pdf
- **Nguyen, Zhang, Montariol & Bosselut, "Rethinking Skill Extraction in the Job Market Domain using
  Large Language Models", NLP4HR 2024 (EACL workshop), 6 February 2024.** LLMs underperform supervised
  baselines on skill extraction but handle syntactically complex mentions better.
  https://arxiv.org/abs/2402.03832

**arXiv, not peer-reviewed — mechanism strong, numbers not about skills**

- **"Layout-Aware Parsing Meets Efficient LLMs: A Unified, Scalable Framework for Resume Information
  Extraction and Evaluation", arXiv:2510.09722.** Deployed in Alibaba Group's CaiMi HR platform,
  240–300 résumés/minute. Source-text verification step. F1 0.917–0.964 on Basic Info / Work / Education
  / Projects. **Does not evaluate skills.** https://arxiv.org/html/2510.09722v1

**Vendor material — usable with the stated caveats**

- **Jobscan, *The State of the Job Search 2025*** — n = 384 recruiters, February–March 2025, Zoho
  Surveys, sampling frame undefined, vendor sells resume optimisation.
  https://www.jobscan.co/state-of-the-job-search
- **HireVue, "Self-Reported vs. Inferred vs. Validated Skills", 15 July 2025** — definitions only, no
  numbers, no marking guidance. https://www.hirevue.com/blog/hiring/type-of-skills-validation

**Checked and rejected as a source**

- **resumeoptimizerpro.com, "Resume Matching Explained"** — the skill-recency scoring claim carries no
  source, study, sample or year; the site sells resume-optimisation tools.

**Prior research this builds on (do not re-derive)**

- [`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md) — §1.4 skills in
  each standard, §2.2 decisions 3 & 4, §5 skill proficiency, and the liveness table for dead standards.
- [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
  — §2.2 (no ATS stores a structured skill object), §4.3 (no skill-proficiency standard),
  Textkernel `foundIn` first flagged.
