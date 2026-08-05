# Career / CV / candidate data standards — what people are actually doing (last 30 days)

**Research window:** 2026-07-05 → 2026-08-04
**Compiled:** 2026-08-04
**Method:** `/last30days` engine (two passes) + direct GitHub API queries + HN Algolia + targeted web
research and primary-source fetches.
**Purpose:** companion evidence to the deep specification research. Weighted toward what is *current*,
what is being *adopted*, and what is being *abandoned* — not toward design quality.

---

## 0. Read this first: how good is this evidence?

**Coverage was uneven, and honestly so.**

| Source | Coverage | Why |
|---|---|---|
| GitHub | **Strong** — primary evidence | Repo stats, issue bodies, commit history all queried directly |
| Web / primary docs | **Strong** | Standards bodies, vendor docs, arXiv fetched directly |
| arXiv / academic | **Strong** | Two 2026 papers with hard numbers |
| Hacker News | **Weak** | Almost nothing on-topic in-window (see §8) |
| Reddit | **Very weak** | Engine's relevance floor dropped 339 then 266 off-topic posts; near-zero on-topic |
| X / Twitter | **Absent** | No credentials configured on this machine |
| YouTube / TikTok | **Absent** | `yt-dlp` not installed |

**The Reddit/HN emptiness is itself a finding, not just a gap.** There is no live developer
*conversation* about career data schemas right now. The real activity is in GitHub issue threads and
academic papers. Anyone waiting for a community consensus to emerge on a forum will wait forever —
this topic has no forum.

**Caveat on X:** the absence of X coverage means I cannot speak to HR-tech founder chatter or
announcement-level noise. Given the task explicitly prioritised first-hand "we built this" accounts
over announcements, this is a smaller loss than it looks, but it is a real one.

---

## 1. Which standards are alive, which are dead

### ALIVE, and the de facto developer default: **JSON Resume**

**EVIDENCE** (GitHub API, queried 2026-08-04):

| Repo | Stars | Forks | Last push | State |
|---|---|---|---|---|
| `jsonresume/resume-schema` | **2,396** | 293 | 2026-06-12 | **ARCHIVED 2026-06-12** |
| `jsonresume/jsonresume.org` (new home, `packages/schema`) | 285 | 65 | 2026-07-29 | Active, 50 open issues |
| `jsonresume/resume-cli` | 4,719 | — | — | `engines: ">=12 <18"`; README says "not actively maintained" |

**What happened in-window:** the schema was moved out of its own repo into a monorepo and the old repo
archived on **2026-06-12**. `npm @jsonresume/schema` is unchanged. On **2026-07-16** alone roughly
fifteen PRs merged (dependency bumps to zod 4 / Next 16, test debt, file-size refactors, docs). On
**2026-07-16** a PR landed titled *"fix(schema): make published schemas cleanly draft-07 compliant"*.
On **2026-07-17**: *"fix(registry): keep salary min:0 and fix open-ended date ranges"*. On
**2026-07-22**: *"fix(jobs-api): ranking quality overhaul"*.

**Interpretation (opinion):** the volume, naming convention ("bug-hunt wave 16", "file-size batch 2",
"accuracy sweep") and cadence of that July burst read as heavily agent-assisted maintenance by a very
small number of humans. The *infrastructure* is churning hard; the *spec* is not. Those are different
things and it is easy to mistake one for the other.

### DEAD: **FRESH** (`fresh-standard/fresh-resume-schema`)

**EVIDENCE:** 559 stars, **last push 2019-02-08**. Self-described as "A rational schema for your
résumé or CV" — it was the principal JSON Resume alternative. Seven years without a commit. If you
were considering FRESH as a reference model, it is a museum piece.

### ALIVE BY REGULATION, STATIC BY DESIGN: **Europass / European Learning Model (ELM)**

**EVIDENCE** (europass.europa.eu, retrieved 2026-08-04):
- ELM v3 launched **April 2023**. Official wording: *"Since the release of ELM v3, there have been no
  significant updates, and this version is now supported long-term by the European Commission."*
- The only 2026 change surfaced: *"From January 2026, countries publishing in the latest ELM format
  need to ensure that the URI header in their LOQ/AMS datasets reflects this change."* A header URI —
  not a model change.
- Code and tooling live on **code.europa.eu (GitLab)**, not GitHub.
- Adjacent and live: European Digital Credentials for Learning (EDC) + the Europass wallet, feeding
  into the EU Digital Identity Wallet (Regulation (EU) 2024/1183; implementing regulations adopted
  2024-11-28). Diplomas/certificates are a named in-scope use case.

**EVIDENCE:** a GitHub search for `europass ELM learning model` (2026-08-04) returned **zero repos**.
That is a direct consequence of the GitLab distribution choice.

**Interpretation (opinion):** ELM's stability is a feature for ministries and a liability for a
product. A model frozen since April 2023 predates the entire current skills-and-AI conversation, and
its distribution channel puts it outside the path any developer would search. It is the right thing
to be *compatible with* for European credential ingest, and the wrong thing to build your core model on.

### ALIVE INSTITUTIONALLY, EFFECTIVELY ABSENT: **HR Open Standards**

**EVIDENCE** (GitHub search, 2026-08-04): the entire GitHub footprint is **two repos** —
`lukegalea/openats` (18 stars, last push **2022-11-04**, "An open source ATS that implements the HR
Open Standards data model") and an empty 2020 working-group repo. Nothing with stars, nothing with
2026 activity.

**EVIDENCE** (hropenstandards.org): the model itself is reasonable — resume-like elements sit in a
`Person Profile` type, which sits inside a `Candidate` type, and `Candidate` carries data a CV never
has (remuneration requirements, position preferences). Schemas are free but distributed as downloads
from the consortium site.

**EVIDENCE:** an issue titled *"Have you heard of HR-XML?"* was opened on `jsonresume/resume-schema`
years ago and never led to convergence. The two worlds have known about each other for a decade.

### PARTIALLY ALIVE, IN A LOPSIDED WAY: **schema.org**

**EVIDENCE** (schema.org, retrieved 2026-08-04):
- `JobPosting` is the well-adopted half (it is what Google Jobs consumes). The *person/career* half is not.
- `occupationalCategory` explicitly instructs implementers to use terms "from taxonomies such as BLS
  O*NET-SOC or ISCO-08", supplying both textual label and formal code.
- `OccupationalExperienceRequirements` is still flagged as **"new"** — "where implementation feedback
  and adoption from applications can help improve definitions". Not settled.
- From the W3C WebSchemas design discussion, a direct modelling instruction: **"Jobs are roles that
  individuals hold over certain periods, so job-related properties should not be put directly under
  schema:Person."**

### NEW, UNCONSOLIDATED: nothing has emerged to replace any of the above

**EVIDENCE** (GitHub search for repos created since 2026-05-01 matching resume/CV structured data,
and for "career graph", 2026-08-04): eight repos named `CareerGraph` / `career-graph`, **all created
within the last four weeks, all at 0 stars**. Dozens of `resume-parser-llm` repos, all 0-1 stars, all
personal projects.

**Interpretation (opinion):** this is the clearest signal in the whole dataset. There is enormous
parallel independent invention of the same idea right now and **zero convergence**. Nobody has a
shared model, nobody is adopting anyone else's, and no new standard is forming. If you are waiting
for the space to settle before committing, it is not going to settle.

---

## 2. What people complain about — the JSON Resume issue list is the best complaint corpus in existence

The single most valuable artifact found: the **"Schema roadmap — consolidated spec discussions"**
issue (opened **2026-06-12**, 4 comments), which groups transferred spec discussions **#288–#323**
into four themes. Those four themes map almost exactly onto our own open design questions.

**EVIDENCE — verbatim structure of that roadmap:**

**Skills, keywords & tagging**
- `#313` — link and globally define skills
- `#320` — per-keyword skill proficiency level
- `#297` / `#293` — add keywords / keyword tags to work
- `#303` — tags or keywords on highlights

**Dates & age-neutral resumes**
- `#322` — make `startDate`/`endDate` optional
- `#309` — represent ongoing current employment

**Location & structure consistency**
- `#323` — add location to work/volunteer/education
- `#298` — allow `basics.location.address`

**New fields & sections** (14 items)
- `#307` — expiry date for certifications · `#312` — pronouns, portfolio, contractType ·
  `#317` — root-level objective · `#299` — status and expects in basics · `#305` — teaching and talks ·
  `#289`/`#295` — richer publication detail and type · `#292` — education summary ·
  `#291`/`#311` — references date, company, relation, affiliation · `#302` — disclosures (race,
  veteran, work-status) · `#300` — categorization, identification, visualization

### The four complaints that matter most to us, with quotes

**(a) Dates break everything.** Issue *"Make startDate/endDate optional & support age-neutral
resumes"* (opened 2025-12-15, 2 comments):

> "Currently many themes display 'Invalid Date' or break when startDate/endDate are omitted from
> work/education entries. This forces candidates to either: 1. Include dates that enable age
> discrimination 2. Remove valuable experience entirely"

The proposed fix is a `datePolicy` field with values `"hidden" | "approximate" | "exact"`, plus a rule
that undated entries sort last. **This is the strongest single design signal in the corpus** — the
schema has no way to say *"a date exists but I am not disclosing it"*, and the difference between
"unknown", "ongoing", and "withheld" is currently unrepresentable.

**(b) The schema was not a valid JSON Schema.** Issue *"schema definitions not compliant with
json-schema"* (opened 2025-12-08, 2 comments): the schema stored reusable definitions under
`definitions`, but "The official standard specifies `$defs` field instead, so the format used isn't
compatible with that, **which breaks usage with json schema compatible tooling**." Fixed
**2026-07-16**.

**(c) Skill proficiency is unrepresentable.** Issue *"Per keyword skill level"* (opened 2025-10-08,
**8 comments — the most-discussed open schema issue**). JSON Resume models skills as
`{name, level, keywords[]}`, so `level` applies to the whole *group*, not to individual keywords. You
cannot say "expert in Python, beginner in Rust" inside one skills entry.

**(d) Language fluency is free text.** Issue *"Standardizing fluency Levels in languages Schema"*
(opened 2024-10-08, 3 comments):

> "There is currently no standardized way to measure fluency in a language. The fluency field is
> simply a string, which leads to inconsistencies when used across different themes. For example,
> some themes cause errors when fluency is set to values like '2' instead of descriptive terms like
> 'Master'."

CEFR is not referenced anywhere in the schema. Every implementation invents its own scale.

**(e) The extensibility escape hatch nobody has approved.** Proposal *"Add `custom` field support for
extensibility"* (opened 2025-02-12, 6 comments):

> "adding fields for every specialized need would make the schema increasingly complex and harder to
> maintain. This proposal suggests a flexible solution: adding an optional `custom` field to every
> object in JSON Resume, including the root object."

Open, unresolved, with three and a half years of accumulated feature requests behind it.

**Other open complaints:** "add country to educations" (2026-06-29) · "Inconsistent location"
(2026-03-25) · "the job schema needs concrete information about salary" (2025-09-29) · "allow schema
to include comments in json file" (2025-08-21) · "37 themes have `main -> src/index.jsx`, so
resume-cli export / npm require() breaks on them" (2026-07-17).

---

## 3. Where practice CONTRADICTS the published standards

This is the section the task flagged as most valuable. Ten findings, ordered by how much they should
change our thinking.

**1. JSON Resume has never shipped 1.0 — yet everyone treats it as the standard.**
*Evidence:* the "1.0 Roadmap [WIP]" issue on the now-archived `resume-schema` repo has been open since
**2020-04-23** with **17 comments**. Two thousand four hundred stars and a whole ecosystem sit on top
of a pre-1.0 spec. There is no stable version of the thing everyone calls a standard.

**2. The npm package people install is AHEAD of the spec repo.**
*Evidence:* the maintainers' own audit (2026-06-05, **15 comments**) states verbatim:
> "**`resume-schema` (2,388★) — version drift.** npm `@jsonresume/schema@1.2.1` is **ahead** of repo
> HEAD `v1.1.2` → **publishing is happening out-of-band**."

The artifact people validate against is not the artifact in the spec repository. There is no single
source of truth even inside the project.

**3. A JSON Schema that was not valid JSON Schema until July 2026.** See §2(b). For years, the
canonical CV schema failed against standard JSON Schema tooling.

**4. schema.org tells you not to model it the way everyone models it.**
*Evidence:* "Jobs are roles that individuals hold over certain periods, so job-related properties
should not be put directly under `schema:Person`." JSON Resume, Europass, HR Open and every practical
CV model put `work[]` directly on the person anyway. Practice unanimously ignores the vocabulary's own
advice — which is worth knowing before we take that advice ourselves.

**5. The official industry standard is invisible where developers work.** HR Open Standards has two
GitHub repos, newest from 2022, combined 18 stars. The standard is distributed as consortium
downloads; developers in 2026 consume schemas from npm, PyPI and git. The distribution model, not the
model quality, is what killed its reach.

**6. Vendors quote ~95% parsing accuracy; the field-level truth is much worse where it matters.**
See §5. The headline is measured on English-language, standard-format resumes.

**7. Everyone points at a taxonomy; nothing open-source actually reaches one at usable accuracy.**
schema.org points at O*NET-SOC/ISCO-08. ESCO exists. Lightcast exists. But the best published
research result for mapping free text to ESCO is **F1@5 = 0.72** (§4), and every open-source skill
taxonomy on GitHub with real structure is an abandoned academic project.

**8. The parsing conversation is about models; the failures are about file formats.**
*Evidence:* "roughly 30% of all real-world parsing failures actually originate" in stage one —
document conversion — not AI reasoning (thehirehub.ai, 2026-05-07).

**9. Entity-resolution star counts invert maintenance reality.** The most-starred library is the one
nobody maintains. See §6.

**10. The standard implicitly requires dates; the law and the practitioners push the other way.**
Age discrimination is illegal in many jurisdictions, but the schema has no way to withhold a date
without breaking renderers ("Invalid Date"). The published model and the legal/ethical practice are in
direct conflict, and the community fix is still an open issue.

---

## 4. Skills as data — the hardest element, and the numbers are sobering

### Hard evidence

**arXiv 2601.09119 — "Contrastive Bi-Encoder Models for Multi-Label Skill Extraction: Enhancing ESCO
Ontology Matching with BERT and Attention Mechanisms" (2026-01-14).** The most useful single result
found.

- **Task:** map unstructured job ads to ESCO — **13,890 Level-4 skills** — framed as *extreme
  multi-label classification*.
- **Best end-to-end result on real data: `F1@5 = 0.72`** (AUPRC 0.90). In controlled comparison,
  models scored F1 0.69 / 0.75 / 0.80.
- Beat TF-IDF cosine similarity and standard BERT baselines.

**Read that number carefully: 0.72 F1 with five guesses allowed.** State-of-the-art, research-grade,
purpose-built, published in 2026. That is the ceiling on "map this text to a skill taxonomy entry",
not the floor.

**Why it is hard — quoted from the paper:**
- *"job ads frequently use informal phrasing, abbreviations, and firm-specific terminology that
  diverge from ontology definitions"*
- misalignment errors, where *"the model retrieves a closely related but not exactly matching skill
  label"*, remain **"substantive"**
- *"semantically adjacent skills (hard negatives)"* must be discriminated
- real postings *"express requirements implicitly (e.g., through tasks, tools, or domain context)"*
- generic skills with *"broad or lexically similar"* definitions *"induce ambiguous supervision"*

**Corroboration that this is a recognised open problem:** TalentCLEF 2025 (CEUR Vol-4038) is a shared
evaluation task specifically for **linking job titles**. A field only builds a benchmark for a problem
it agrees is unsolved. A second paper, arXiv 2512.03195 (Dec 2025), covers occupation/skill/
qualification linking against ESCO **and EQF** together.

### The taxonomies themselves

**Lightcast Open Skills** (retrieved 2026-08-04) — the most alive of the taxonomies:
> "an open-source taxonomy of 34,000+ skills gathered from hundreds of millions of online job
> postings, profiles, and resumes — **updated every two weeks**"

31 skill categories (as of March 2025); three areas (specialized, common, software); full changelog;
a Skills Extractor for normalisation; data drawn from 40,000+ sources daily.

**Evidence-quality note:** Lightcast's own live pages give **three different skill counts
simultaneously — 32,000+, 34,000+ and 35,000+**. Treat any specific count as approximate. This is not
a gotcha; it is what a two-week release cadence looks like from outside.

**ESCO** — 13,890 Level-4 skills (per the paper above), multilingual, maps skills to occupations and
qualifications, EU-governed. GitHub footprint: essentially nil (two repos, both 0-1 stars).

**O\*NET** — referenced by schema.org as an acceptable `occupationalCategory` source. US-centric,
occupation-first rather than skill-first.

**The open-source skill-taxonomy graveyard** (GitHub, 2026-08-04):

| Repo | Stars | Last push |
|---|---|---|
| `nestauk/skills-taxonomy-v2` | 39 | 2022-10-12 |
| `jensjorisdecorte/Skill-Extraction-benchmark` (ESCO-based) | 17 | 2024-07-18 |
| `maudgrol/Data_driven_skills_taxonomy` | 10 | 2025-03-13 |
| `tanova-ai/skills-taxonomy` (aliases, transferability scores, proficiency markers, CC BY 4.0) | 5 | 2026-02-10 |
| `india-kerle/skills_taxonomy` | 2 | 2022-06-30 |

The only 2026-active repo in this space with meaningful traction is **`he-yufeng/FindJobs-Agent`** —
**253 stars, created 2025-11-15, pushed 2026-08-03** — "LLM-powered toolkit for skill analysis, AI
interviews, resume scoring, and job structuring. Automates professional skill taxonomy." Note the
framing: it does not *use* a taxonomy, it *generates* one with an LLM.

**False positive worth flagging:** a cluster of new "Marble Skill Taxonomy" repos surfaced
(`tbh-23/Homestead` 8★ created 2026-07-22, `acastellana/marble-curriculum` 7★ 2026-07-08,
`ashutoshsinghpr7/marble-taxonomy-explorer` 6★ 2026-07-10) describing ~1,590 micro-topics across 8
subjects wired by ~3,221 prerequisites. **This is a K-12 curriculum taxonomy, not an employment one.**
Do not mistake it for a career standard. The *shape* is interesting though — a prerequisite-linked
graph of micro-skills is a structure a career model could borrow.

### Embeddings vs taxonomies

**CLAIM — vendor content, not verified** (Gloat, "Why generic embeddings fail for workforce
decisions", no publication date shown). Reported similarity scores under generic embeddings:

| Pair | Generic | Claimed workforce-specific |
|---|---|---|
| Java Developer vs JavaScript Developer | **0.85–0.92** | — |
| Data Engineer vs Data Entry Clerk | 0.78 | 0.18 |
| Product Manager vs Project Manager | 0.91 | 0.61 |
| Supply Chain Analyst vs Workforce Planning Analyst | **0.34** | 0.68 |

They further claim +27 to +42 percentage points across five workforce retrieval tasks.

**Assessment:** the accuracy table discloses no methodology, sample size or validation and should be
treated as marketing. **But the failure examples are the useful part and they are credible on their
face** — Java/JavaScript scoring 0.85–0.92 is exactly the trap, and the Supply Chain / Workforce
Planning row shows the error runs *both ways*: generic embeddings also **under**-rate genuinely
adjacent roles.

**Neutral corroboration** (survey literature): *"Generic embedding models trained on web-scale text
corpora encode linguistic similarity, not workforce reality"*; *"Many practical systems fall back on
keyword rules or generic similarity matching, which are brittle under vocabulary mismatch (synonyms,
paraphrases, and local jargon)"*. Consistent finding across sources: **hybrid taxonomy + embeddings
beats either alone**; neither alone is adequate.

### The consensus on skills, stated plainly

Three independent sources, three different methods, one agreement: **skills is the weakest field.**
Skill extraction sits at 0.75–0.85 F1 (vendor-adjacent per-field data), skill→taxonomy mapping at 0.72
F1@5 (peer-reviewed), and generic embeddings confuse adjacent-but-different roles at 0.85+ similarity
(vendor claim, plausible mechanism). Nobody has solved this. Anyone claiming they have is selling.

---

## 5. LLM extraction from CVs — what accuracy people actually get

**EVIDENCE — thehirehub.ai, "AI Resume Parsing in 2026" (published 2026-05-07).** Vendor-adjacent, but
the only source found that publishes a **per-field** breakdown, which is what makes it useful:

| Field | F1 |
|---|---|
| Name, email | **0.99+** |
| **Dates and titles** | **0.93–0.96** |
| **Skills** | **0.75–0.85** |
| Headline (vendor benchmark, whole doc) | 0.92–0.95 |

Stated caveat, verbatim: the ~95% figures are *"measured against benchmark corpora of
English-language, standard-format resumes, which is not the same accuracy you will see on actual
candidate populations."* Rule-based predecessors managed 60–70%.

**The five-stage pipeline** (each stage degrades accuracy):
1. Document conversion (PDF/DOCX/image)
2. Layout reconstruction
3. Section segmentation
4. Field extraction
5. Normalisation and taxonomy mapping

**The most actionable single number in this report:** *"roughly 30% of all real-world parsing failures
actually originate"* in **stage one — document conversion**. Not the model. Not the prompt. The file.

**Named failure modes:** multi-column layouts · ATS-optimised text walls · mixed-language resumes ·
scanned PDFs and OCR errors · **non-Latin scripts and transliterated names**.

**On titles specifically:** LLM parsers handle "Sr. Eng II" and "Senior Engineer 2" as the same role
gracefully — *"though they hallucinate, occasionally normalizing to a title or skill the candidate
never claimed."* That is the exact hazard for an audited record: silent, plausible, upgrade-shaped
fabrication.

**On degree vs certification:** no source found publishes a separate accuracy figure for
distinguishing a degree from a certification. What the evidence does show is that the *schema* side
of that distinction is unresolved too — JSON Resume has a separate `certificates` section, but
"expiry date for certifications" is still an open proposal (`#307`), and "add certificates to sample
resume" (`#294`) is open, meaning the section is under-exercised in practice. **Treat this as an
unknown, not as a solved problem.**

**EVIDENCE — arXiv 2510.09722 (Oct 2025), "Layout-Aware Parsing Meets Efficient LLMs".** Names the
three production constraints directly: *"layout and content heterogeneity, high cost and latency of
LLMs, and lack of high-quality annotated datasets due to privacy concerns."* That third one matters —
you cannot easily buy or share a good labelled CV corpus, so everyone's accuracy claims rest on
private, unauditable test sets.

**Also exists, numbers not retrieved:** "LLM-Driven Resume Parsing and Job Description Matching:
Evaluation on 998 Real Resumes"; arXiv 2507.02087 "Evaluating the Promise and Pitfalls of LLMs in
Hiring Decisions" (Jul 2025).

---

## 6. Employer / organisation entity resolution

### What the tooling landscape says

**EVIDENCE** (GitHub API, 2026-08-04):

| Library | Stars | Last push | Verdict |
|---|---|---|---|
| `moj-analytical-services/splink` | 2,312 | **2026-08-04 (same day)** | **Live, actively shipping** |
| `zinggAI/zingg` | 1,233 | 2026-07-28 | Live |
| `dedupeio/dedupe` | **4,491** | **2025-07-29** | One year stale |
| `J535D165/recordlinkage` | 1,057 | 2024-02-21 | Dead (~2.5 years) |

**The adoption signal inverts the star counts.** `dedupe` is the one everyone links to and nobody
maintains; `splink` (probabilistic linkage, Fellegi-Sunter) is where the work actually is. If we pick
a library off a "top entity resolution tools" blog post we will pick the stale one.

### What practitioners actually do

**EVIDENCE — OpenCorporates (blog, 2025-06-17) + GLEIF:** OpenCorporates *"applies fuzzy logic and
machine learning to collapse duplicates, with **survivorship rules** to decide which source 'wins'
when facts conflict"*, then enriches records by attaching external identifiers such as LEI. GLEIF and
OpenCorporates published the first open-source LEI↔OpenCorporates relationship file in **April 2023**;
by 2023 GLEIF had linked **over half of all LEIs** to OpenCorporates IDs. The GLEIF API returns a
deterministic **`matchConfidence` (0–100)** and an **`exactMatch`** flag.

**EVIDENCE — practitioner guide (dev.to, "A Practical Guide To Entity Resolution in Python (No
Database, No Machine Learning)"):** RapidFuzz `WRatio` at a **threshold of 90** — "unrelated pairs stay
out while suffix/spacing variants merge."

**The stated limitation is the answer to our HSBC question, verbatim:**
> **"Fuzzy matching handles stylistic drift on the same name; it can't handle unrelated brand vs legal
> entity pairs."**

**Interpretation (opinion), directly applicable to us:** "HSBC" vs "HSBC Holdings plc" is *stylistic
drift* — the easy case. Fuzzy matching at threshold ~90 solves it, and so does an LLM. The cases that
actually break are the ones no string method can touch:
- **brand ≠ legal entity** — "Google" vs "Alphabet Inc.", "Meta" vs "Facebook, Inc."
- **subsidiary vs parent** — is "HSBC Bank plc" the same employer as "HSBC Holdings plc"? For a CV,
  usually yes. For a legal record, no.
- **rebrands and acquisitions over time** — someone who worked at "Anadarko" in 2018 worked at a
  company that no longer exists. A record that spans decades will accumulate these.
- **the same name, different companies** — small firms, common words.

The pattern that works is not one technique but a **layered** one: normalise → deterministic match on
a registry identifier where one exists → probabilistic/fuzzy match → **survivorship rules for
conflicts** → human confirmation for the residue. And **the relationship graph (parent/subsidiary/
former-name) is the part fuzzy matching cannot supply** — that has to come from a registry (GLEIF,
OpenCorporates) or from the user.

---

## 7. Is anyone modelling a career as a LIVING RECORD?

Short answer: **yes, in ones and twos, and nobody has converged.** This is the least-solved and
least-standardised of the six questions.

### The best first-hand account found

**EVIDENCE — mcgarrah.org, "Rebuilding My Resume Site From the Ground Up" (2026-05-14).** A developer
rebuilt his resume around a **single YAML file** (`_data/data.yml`) that renders four HTML views
(brief, print, ultra-brief, machine) plus a separate Python/Jinja2/XeLaTeX PDF pipeline.

His thesis, verbatim:
> **"a resume should not be a static document you update twice a year. It should be a living system —
> structured data that multiple consumers can query, render, and reason about."**

And on the architecture:
> "Everything renders from `_data/data.yml`. **No content duplication across views.**"

The "machine view" emits **JSON-LD** specifically so agents and ATS can parse it programmatically.

**Two things about this account matter more than the thesis.**

**First — he did not use JSON Resume.** The post never mentions it. A developer building in 2026
exactly the thing JSON Resume exists for reached for a hand-rolled YAML file instead. That is a
harder adoption signal than any star count.

**Second — what broke in his old, document-first setup** is the concrete cost of treating the document
as the input: the Pandoc export path needed **"16 regex patterns to strip sidebar markup"** before it
produced clean PDFs. When the document is the source, every new output format is a regex archaeology
project.

### Commercial evidence

**TailorCV** (tailorcv.com, retrieved 2026-08-04) markets a **"Career Record"** as *"the source of
truth for accomplishments, skills, and outcomes"* — structured, **peer-verified**, portable, with
resumes and promotion cases generated from it. Marketing, not first-hand, but it confirms the category
is being sold in 2026 and that "verification" is the differentiator being reached for.

### JSON Resume is drifting this way too

**EVIDENCE:** in-window, the JSON Resume registry gained a **jobs API with a ranking overhaul**
(2026-07-22) and an open **"RFC: stabilize job-schema v1"** (2026-06-12). The project is becoming a
**two-sided** data model — resume *and* job — rather than a document schema. That is the same
directional bet as ours, made independently.

### The credential-wallet track

**EVIDENCE:** European Digital Credentials for Learning + the Europass wallet + the EU Digital Identity
Wallet (Reg. (EU) 2024/1183) constitute the only *institutionally funded* living-record effort. It is
credential-shaped (diplomas, certificates — things an institution issues) and has nothing to say about
the parts of a career nobody issues a certificate for, which is most of it.

### And the strongest signal of all: 0 stars, everywhere

**EVIDENCE:** eight `CareerGraph` repos created in the last four weeks, all at 0 stars (§1). Dozens of
`resume-parser-llm` repos, all 0–1 stars. **Everybody is building this; nobody is adopting anybody
else's.**

**Interpretation (opinion):** the "living record" idea is clearly in the air — a solo developer, a
funded startup, the JSON Resume maintainers and the European Commission all arrived at variants of it
independently in the last year. What does *not* exist is a shared model, a reference implementation
with traction, or a published account of someone running one at scale for years and reporting what
broke. **We will not find prior art that de-risks this. There isn't any.**

---

## 8. Community discussion levels — weighing consensus against one loud voice

Being explicit about engagement, because most of this report rests on a small number of documents.

**Highest-engagement in-window items that are structurally relevant** (all Hacker News, none
CV-specific):

| Date | Item | Engagement |
|---|---|---|
| 2026-07-09 | Launch HN: Context.dev (YC S26) — API to get structured data from any website | **119 points, 86 comments** |
| 2026-07-01 | Launch HN: Parsewise (YC P25) — Reason Across Documents with an API | 56 points, 54 comments |

Both are "structured extraction as a service" plays. The market interest is in *generic* document→
structure, not in career data specifically.

**The most relevant HN thread on ATS architecture** — "Why applicant tracking systems are broken by
design" (2026-02-19) — is **outside the window and got only 18 points / 14 comments**. Low engagement.
Treat any claim sourced from it as one voice, not consensus.

**Engagement on the GitHub evidence** (this is where the real discussion is):

| Item | Comments | Date |
|---|---|---|
| JSON Resume org consolidation audit | **15** | 2026-06-05 |
| JSON Resume 1.0 Roadmap [WIP] | **17** | 2020-04-23 (still open) |
| Maintenance: Cleanup (archived repo) | 12 | 2020-03-27 |
| Registry uptime: Supabase down | 11 | 2026-07-18 |
| Per keyword skill level | **8** | 2025-10-08 |
| `custom` field extensibility proposal | 6 | 2025-02-12 |
| Schema roadmap (consolidated) | 4 | 2026-06-12 |
| startDate/endDate optional | 2 | 2025-12-15 |
| Languages fluency standardisation | 3 | 2024-10-08 |

**Honest reading: these are small numbers.** The most-discussed *design* question in the entire JSON
Resume corpus has eight comments. This is not a field with strong consensus that we would be foolish
to contradict. It is a field with a handful of engaged people and a large number of unresolved
questions. That cuts both ways — less accumulated wisdom to draw on, but also much less reason to
defer to it.

**Reddit context (adjacent, mood only — not evidence about schemas):** r/dataengineering, 2026-08-03,
"Is anyone else losing interest in data engineering?" — 180 upvotes, 75 comments. Top comment
u/kanyeswift (**119 upvotes**): *"senior DE here - extremely burnt out, looking for an exit."*
u/Brief-Knowledge-629 (**64 upvotes**): *"I've been in the data business for over a decade. Data
engineering.....is kind of dumb lol. I have yet to provide anything of value to a customer or internal
stakeholder."* Included only because it is the loudest voice the search reached in the adjacent
professional community, and it is about disillusionment with data plumbing, not about career schemas.

---

## 9. Implications for our design — clearly labelled as interpretation

Everything in this section is **my reading**, not evidence. Separated deliberately.

1. **Do not adopt any existing standard wholesale; adopt JSON Resume as an import/export shape only.**
   It is pre-1.0, its npm artifact diverges from its repo, it cannot represent skill proficiency,
   language fluency, undisclosed dates, or ongoing employment, and its own maintainers have a 23-item
   backlog covering exactly those gaps. It is the right *interchange* format because it is what tools
   read. It is not a model to build on.

2. **The date model is the highest-value place to be better than everyone else.** The community's own
   proposal — `datePolicy: "hidden" | "approximate" | "exact"` — is the right instinct and is *still an
   open issue*. Our record needs to distinguish at minimum: exact, approximate, ongoing, unknown, and
   withheld. Every existing standard collapses these into one nullable string and renders "Invalid Date".

3. **Budget for skills being wrong.** 0.72 F1@5 against ESCO is the research ceiling. Any design that
   requires confident automatic skill→taxonomy mapping will fail. The workable shapes are: keep the
   candidate's own words as the primary record, attach taxonomy links as *annotations with
   confidence*, never as replacements, and make the human confirmation step cheap because it will be
   used constantly.

4. **Spend engineering on document conversion, not prompts.** 30% of failures happen before the model
   sees anything. That is the cheapest accuracy available.

5. **Entity resolution needs a relationship graph, not a better string matcher.** "HSBC" vs "HSBC
   Holdings plc" is the easy case and is already solved. Parent/subsidiary, rebrand and acquisition
   history is the hard case and requires either an external registry or asking the user. Design the
   escape hatch first.

6. **There is no prior art to de-risk the living-record bet.** Nobody has published "we ran a career
   record for five years and here's what broke." We will be the ones finding out. That is a risk worth
   naming explicitly in the spec rather than assuming someone else has already proven the shape.

---

## 10. Sources

Ordered by evidentiary weight. First-hand and primary sources first.

**Primary (GitHub API, queried 2026-08-04)** — repo statistics, issue bodies and commit history for
`jsonresume/jsonresume.org`, `jsonresume/resume-schema`, `fresh-standard/fresh-resume-schema`,
`moj-analytical-services/splink`, `zinggAI/zingg`, `dedupeio/dedupe`, `J535D165/recordlinkage`,
`he-yufeng/FindJobs-Agent`, `lukegalea/openats`, plus repo searches for resume schema, skills taxonomy,
career graph, HR Open Standards, ESCO and Europass/ELM.

**Peer-reviewed / preprint**
- arXiv **2601.09119** (2026-01-14) — Contrastive bi-encoder ESCO skill extraction. F1@5 = 0.72.
- arXiv **2512.03195** (Dec 2025) — Occupation/skill/qualification linking with ESCO and EQF.
- arXiv **2510.09722** (Oct 2025) — Layout-aware parsing + efficient LLMs for resume extraction.
- arXiv **2507.02087** (Jul 2025) — Promise and pitfalls of LLMs in hiring decisions.
- CEUR **Vol-4038** — TalentCLEF 2025, job-title linking shared task.

**First-hand practitioner accounts**
- **mcgarrah.org** (2026-05-14) — "Rebuilding My Resume Site From the Ground Up". Single-YAML
  living-system architecture; the "16 regex patterns" cost of document-first; explicitly did not use
  JSON Resume.
- **dev.to / prithwish_nath** — "A Practical Guide To Entity Resolution in Python (No Database, No
  Machine Learning)". RapidFuzz WRatio threshold 90; the brand-vs-legal-entity limitation.

**Standards bodies and primary documentation**
- **europass.europa.eu** — ELM v3 status ("no significant updates"), January 2026 URI-header change,
  European Digital Credentials for Learning, Europass wallet.
- **digital-strategy.ec.europa.eu** — EU Digital Identity Wallet implementation; Reg. (EU) 2024/1183.
- **schema.org** — `Occupation`, `occupationalCategory`, `qualifications`,
  `OccupationalExperienceRequirements`; W3C WebSchemas discussion on Role vs Person modelling.
- **hropenstandards.org** — Candidate / Person Profile recruiting specification.
- **lightcast.io** — Open Skills taxonomy, FAQs, knowledge base, Skills API docs.
- **gleif.org** / **blog.opencorporates.com** (2025-06-17) — LEI mapping, survivorship rules,
  matchConfidence.

**Vendor / secondary (treated as claim, not evidence)**
- **thehirehub.ai** (2026-05-07) — "AI Resume Parsing in 2026". Per-field F1 breakdown; five-stage
  pipeline; the 30%-of-failures-are-conversion figure. Vendor-adjacent but the only per-field source found.
- **gloat.com/academy** (no date) — "Why generic embeddings fail for workforce decisions". Similarity
  tables and +27–42pt claims. **No methodology disclosed — marketing.** The failure examples are
  useful; the accuracy table is not verifiable.
- **tailorcv.com** — "Career Record" product positioning.
- **learnworkecosystemlibrary.com** — third-party summaries of the Lightcast and HR Open Standards
  initiatives.

---

## Appendix: research run provenance

```
🌐 last30days v3.8.3 · synced 2026-08-04

Pass 1 — "Structured data models for careers CVs and candidate profiles"
---
✅ All agents reported back!
├─ 🟠 Reddit: 13 threads │ 12,515 upvotes │ 1,802 comments
├─ 🟡 HN: 16 storys │ 364 points │ 261 comments
├─ 🐙 GitHub: 1 item │ 285 stars │ 50 comments
├─ 🗣️ Top voices: r/webdev, r/dataengineering
└─ 📎 Raw results saved to ~/Documents/Last30Days/structured-data-models-for-careers-cvs-and-candidate-profiles-raw-v3.md
---

Pass 2 — "LLM extraction of candidate data and employer entity resolution"
---
✅ All agents reported back!
├─ 🟠 Reddit: 20 threads │ 687 upvotes │ 420 comments
├─ 🟡 HN: 3 storys │ 722 points │ 351 comments
├─ 🐙 GitHub: 24 items │ 7 reactions │ 1,220 comments
├─ 🗣️ Top voices: r/dataengineering, r/recruiting, r/LLMDevs
└─ 📎 Raw results saved to ~/Documents/Last30Days/llm-extraction-of-candidate-data-and-employer-entity-resolution-raw-v3.md
---
```

Both engine passes reported 3/5 core sources (X/Twitter and YouTube unavailable — no credentials /
`yt-dlp` not installed on this machine). The Reddit relevance floor dropped 339 posts in pass 1 and
266 in pass 2 as off-topic. The bulk of the evidence in this report came from direct GitHub API
queries, HN Algolia, and primary-source fetches rather than from the social-listening passes — which
is the correct outcome for a topic whose discussion lives in issue trackers and papers.
