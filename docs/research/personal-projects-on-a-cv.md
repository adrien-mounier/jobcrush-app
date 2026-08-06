# Does a personal project have a section of its own — and how is one actually written?

_Deep-sources half of the research for [#147](https://github.com/adrien-mounier/jobcrush-app/issues/147),
under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127). Blocks
[#146](https://github.com/adrien-mounier/jobcrush-app/issues/146). Sibling
[#148](https://github.com/adrien-mounier/jobcrush-app/issues/148) asks whether project / portfolio /
GitHub / website / open-source are one section or several — this half is the project entry itself.
Written 2026-08-06._

_A `/last30days` companion covers recent movement. This half covers established, high-trust primary
sources: shipped schemas read from source, live parser SDKs, official platform documentation,
institutional career-service guidance, published corpora._

**What this document is not.** It does not re-derive
[`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md) or
[`skill-shape-granularity-normalisation-levels.md`](skill-shape-granularity-normalisation-levels.md).
Where it corrects one of them, it says so loudly, because two of the corrections matter.

---

## Bottom line

**1. The corpus contradicts the ticket's shape, and it is not close.** Six CVs. **One** carries a
standalone projects section — the owner's own. **Two** carry named project entries *nested inside
jobs*, and the CV with by far the most project content in the corpus is the one with **no** standalone
section: Thomas Chauviere's façade-engineering CV carries **~19 named projects, every one of them
inside a job**. #146 has been designing against the rarer of the two shapes.

**2. The ticket's Q5 hypothesis is a false dichotomy, and the shipped answer is "both".** A project is
not *either* evidence for skills *or* a peer element. In every system that models projects at all, it
is a **container with its own identity that also carries the skills it used** — exactly what a job is.
RChilli's project object is literally `ProjectName` + `UsedSkills` + `TeamSize`. Naming a thing and
holding skills are not competing designs; they are the same design.

**3. Every shipped schema agrees a project has no organisation — and every one replaces it with a
parent pointer.** ADR-0003 clauses 1–4 gave each element an organisation slot, and the ticket noticed a
project has none. Correct, and universal. But no schema leaves the slot empty: **LinkedIn's `occupation`
field points at one of the member's own positions** (*"Position a member held while working on this
project"*); **RChilli nests the project inside the employment block** and parses it nowhere else; JSON
Resume offers an optional free-text `entity`. The map has been treating "no organisation" as an absence
to accommodate. It is a **relationship to model**.

**4. Undated is legal, expected, and shipped — but it is not a fourth end-state of a range.** LinkedIn's
Project schema makes **`title` and `members` the only required fields**; every date field is optional.
It also ships a `singleDate` boolean *"that distinguishes between an ongoing project without an end date
and a project that occurred at one specific time."* So the shipped model is: range, ongoing,
point-in-time, **or no dates at all**. ADR-0003 clause 6 assumed every dated thing has a range; for a
project the whole date block is optional in a way it never is for a job. That is a difference in kind,
not a fourth state.

**5. 🚨 JSON Resume is not dead. The map's own liveness finding is wrong, and this is the correction that
matters most.** #145 recorded `resume-schema` and `resume-cli` as archived and read that as death. They
*are* archived — but the repo description says why: **"MOVED to jsonresume/jsonresume.org
(packages/schema) — npm @jsonresume/schema unchanged"**. The npm package published **v1.3.1 on
2026-07-22**, fifteen days before this was written. The schema lives in an active monorepo pushed
2026-07-29. **The one standard with a first-class top-level `projects` array is live and shipping.** An
archived repo was read as an abandoned project; it was a relocation.

**6. The live reference implementation's project entry looks nothing like the owner's.** JSON Resume
ships three official example CVs. Their project entries carry **name + one-line description + bullet
highlights + a keyword/technology array + dates + a URL + roles**. Adrien's three entries carry **a bold
title and a prose paragraph — no dates, no URL, no keyword list, no bullets**. The shape our only local
example gives us is the shape no shipped system models well.

**7. Who carries one is not who the advice says.** JSON Resume's own examples are the cleanest signal
found anywhere: **new-grad → 2 projects. senior-engineer → 1 project. career-changer → 0.** The senior
engineer's is open-ended (`startDate`, no `endDate`). This contradicts the standard career-advice line
that projects are for juniors and career changers and get dropped with experience — and it matches our
owner, who has 7+ years and carries three.

**8. No ATS holds a structured project object, and no project is a filter criterion anywhere.** #137
found no structured *skill* object in Greenhouse, Lever or iCIMS. The same is true of projects, and
worse: **Textkernel — the market-leading parser — has no project object at all**, in a data model with
25 top-level members including `Hobbies`, `Patents` and `SpeakingEngagements`. A `PERSONAL PROJECTS`
section, parsed by Textkernel, lands in `Achievements` (a flat `List<string>`) or nowhere.

**9. There is no reliable number for how many CVs carry a projects section, and I could not verify a
single one of the circulating recruiter statistics.** See *Numbers weaker than they look*. The
percentages currently being repeated across the web ("71% of hiring managers check GitHub", "80% value
personal projects", "76% say portfolios outweigh education") trace to SEO content farms citing each
other. **Do not put any of them in a spec.**

**What this costs, in plain terms.** The cheap finding is that you already have the data: the corpus
hands you projects nested in jobs, dated by their parent, with a technology named inline. The expensive
choice is that the standalone section — the one shape #146 has been designing for — is the rarer one, is
unparseable by the market-leading parser, and appears on one CV in six. **Design the nested case first;
the standalone section is a rendering of the same element without a parent.**

---

## The local corpus count — done before any searching

Six PDFs in `data/cvs/`, all read in full. #130's table was overturned by exactly this check, so here it
is before anything external.

### How many carry a projects-like section

| CV | Role / market | Standalone projects section | Projects nested in another element |
|---|---|---|---|
| **Adrien Mounier** — Senior Project Manager, banking IT, Bangkok | IT-PM | **YES — `PERSONAL PROJECTS`, 3 entries** | ⚠️ **Corrected** — an italic `Project Achievements` sub-block under **all three** jobs (8 / 3 / 2 bullets), but it is **a label over a second bullet list, not a set of named project entries** (see below, and [ADR-0009](../adr/0009-a-work-project-stays-a-bullet.md) clause 4). Counting it as a second nested case overstated the nested shape. |
| **Thomas Chauviere** — Dessinateur / Chef de projet, façade engineering, CH+FR | Construction | No | **YES — a `Projets:` line or `Projet:` heading inside 8 of 8 jobs, ~19 named projects** |
| **Giuliana Delre** — Purchasing Manager, food industry, Bangkok | Non-technical | No | Yes — one `Thesis` line under Education |
| **Pierre Mounier** — Customer Success Specialist, Lisbon | Non-technical | No | No |
| **Kulpakorn Ngamvijit** — Senior Business Analyst, banking IT, Bangkok | IT-BA | No | No |
| **Remy IM** — IT System Analyst, Paris + Singapore | Technical IT | No | No named projects — but a **parenthetical technology list on nearly every bullet** |

**Counts:**
- Standalone projects-like section: **1 of 6.**
- Named project *entries* nested inside a job: **2 of 6** (Adrien, Thomas).
- Project-like item nested under education: **1 of 6** (Giuliana's thesis).
- No project element of any kind: **3 of 6** (Pierre, Kulpakorn, Remy).
- **Total named project entries in the corpus: 3 standalone, ~21 nested.** The nested form outnumbers
  the standalone form roughly seven to one.

⚠️ **Two corrections to the counts above, made by [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150)
and recorded in [ADR-0009](../adr/0009-a-work-project-stays-a-bullet.md) clauses 2–4. The counts are honest;
the inference drawn from them was not.**

1. **"2 of 6" should be 1 of 6.** Adrien's `Project Achievements` is a **label over a second bullet list**,
   not a set of named project entries — the named projects live *inside* the bullets (see the fourth
   micro-shape below). Thomas is the only CV with named project sub-entries.
2. **The 7:1 ratio is one document, from another market and profession.** ~18 of the ~22 nested mentions are
   Thomas Chauviere alone — façade engineering, France and Switzerland. Across the **five** CVs in our
   actual market (banking / IT-PM), named project sub-entries carrying a client, dates and their own
   bullets number **zero**. The ratio is real; reading it as *"the nested shape is what our users do"* is
   not. Nor is the rich shape as common as it looks: **0 of 18** of Thomas's named projects carries a date
   of its own, and **10 of 18** have no bullets at all.

### Anatomy of every entry

**The 3 standalone entries (Adrien, `PERSONAL PROJECTS`):**

| Part | Present? |
|---|---|
| Title | **3 / 3** — bold, on its own line |
| Dates | **0 / 3** |
| Organisation | **0 / 3** |
| Link | **0 / 3** |
| Bullets | **0 / 3** |
| Prose paragraph | **3 / 3** — 2–4 sentences |
| Technology list *as a list* | **0 / 3** |
| Technologies *named inline in the prose* | **3 / 3** — `Claude Code`, `Gemini CLI`, `Codex`, `Markdown`, `Notion` |

**The ~19 nested entries (Thomas)** come in two distinct shapes, and the difference is load-bearing:

- **Shape A — the roll-up line.** A single italic line directly under the job heading listing several
  projects, each with a parenthetical descriptor and nothing else:
  `Projets: Grands Bois (travaux de façades de 3 Villas) ; Vieusseux (rénovation de façades d'une tour
  de 15 étages) ; Raffeisein (rénovation de façades de bureau) ; Croisette 12 (…) ; La Combaz A9 (…)`.
  Five projects in one line. No dates, no bullets, no link. Used at FACETEC (5) and Groupe Gottburg (5).
- **Shape B — the project as a heading with its own bullets.**
  `Projet: EPR UK1221 - Ferraillage d'enceinte interne d'une centrale nucléaire sur Tekla`, followed by
  4 bullets. `Projet: BARRACUDA – Refonte d'une base sous-marine (DDT et PLA AVP) sur Revit`, followed
  by ~11 bullets. **Each carries a technology in the title itself** — `sur Tekla`, `sur Revit`,
  `sur Autocad` — and `Tekla`, `Revit` and `Autocad` all also appear in his `Logiciels` section.

Three further things in Thomas's CV that the map has not accounted for:

- **A third organisation state.** Shape B projects sit inside *client* sub-blocks —
  `ASSYTEM (client) - 02/2021 - 05/2021`, `TRACTEBEL (client) - 10/2018 -12/2020` — nested inside the
  employer `BTM CONSULTANT`. So the project's organisation is neither the employer nor absent; it is a
  **client, distinct from both**, and it is the thing carrying the dates.
- **Nested projects can be dated.** The ticket's "no dates at all" is true of the standalone section and
  of Adrien's `Project Achievements`. It is **false** for Thomas's client blocks.
- **Adrien's own nested projects use a fourth micro-shape:** title-prefixed bullets —
  `Chatbot FINDER: Coordinated development of a chatbot…`, `CRM Data Pipeline Optimization: Supported
  delivery of…`. A name and a description fused into one bullet.

### The finding nobody asked for

**Not one CV in the corpus carries a project link. Zero GitHub URLs. Zero portfolio URLs.** The only URL
anywhere in six CVs is Remy's LinkedIn profile in his header. Whatever #148 concludes about portfolios
and GitHub as sections, **our corpus provides no local evidence that they appear at all** — and the
0-of-17 advert sweep says nothing asks for them either.

### And the mention-site property is stronger than the ticket claims

The ticket noticed Adrien's projects name tools that are also in his skills section. That property holds
in **3 of 6** CVs, at three different granularities:

- **Adrien** — technologies inside project prose, also in `SKILLS`.
- **Thomas** — a technology in the project title (`sur Tekla`), also in `Logiciels`.
- **Remy** — a parenthetical technology list on nearly every *bullet* (`(C#, XrmToolBox, Git)`,
  `(Splunk, Control-M, Bash, Linux)`), also in `ADDITIONAL SKILLS` — **with no project at all.**

Remy is the important one. He proves the mention-site is a property of **an accomplishment**, not of a
project specifically. If #146 builds "project as mention-site" as a special case, it will have built the
narrow version of something the corpus already does more generally.

---

## Q1 — Does the section exist, what is it called, and how common is it?

**It exists as a named convention, and `Projects` — not `Personal Projects` — is the dominant name in
every shipped system.**

- **LinkedIn** ships **`Projects`** as an addable profile section, listed under the **Recommended**
  grouping alongside `Featured`, `Licenses & certifications`, `Courses` and `Recommendations` — one tier
  above `Publications`, `Patents` and `Honors & awards`, which sit under **Additional**.
  ([LinkedIn Help — Add sections to your profile](https://www.linkedin.com/help/linkedin/answer/a540837/add-sections-to-your-profile))
- **JSON Resume** ships a top-level **`projects`** array, described as *"Specify career projects"*.
  ([schema.json](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json))
- **Europass** treats projects as an add-on, not part of the basic profile: *"Once you complete your
  basic Europass profile (education and training, work experience, language skills, digital skills), you
  will be able to update and edit the rest of the profile with other projects, achievements and skills
  you want to record."*
  ([Europass — How to complete my Europass profile](https://europass.europa.eu/en/how-complete-my-europass-profile))
- **Berkeley Career Engagement** groups it with other experience rather than naming it separately:
  resume sections *"can include any of the following work, research, volunteer, and project experience"*.
  ([Berkeley — Resumes](https://career.berkeley.edu/prepare-for-success/resumes/))

**`Personal Projects` specifically is not the convention.** No shipped schema uses the word "personal",
and LinkedIn, JSON Resume and Europass all use the bare noun. The owner's heading is a defensible
personal choice, not a standard label.

### Frequency: no reliable number exists, and I looked hard

This is the second "no reliable number" finding on this map, and it is worth stating as plainly as #137's
was.

**What I checked and what it gave:**

- **English-language academic resume corpora do not have a projects class at all.** The *Construction of
  English Resume Corpus* work annotates resume blocks with seven labels — *Experience, Personal
  Information, Summary, Education, Qualifications, Skill, Object* — and **projects is not among them**.
  ([arXiv:2208.03219](https://arxiv.org/abs/2208.03219)) ⚠️ **Caveat on this citation:** the arXiv PDF
  would not yield text to automated fetch, and the label list above comes from search-result summaries of
  the paper, **not from the paper read directly**. Treat it as indicative, not established.
- **Chinese-market corpora do.** The Alibaba CaiMi work extracts four categories — *basic information,
  work experience, **project experience**, and education background* — from **RealResume, 13,100 real
  resumes from Alibaba's HR system**, described as *"mixed Chinese-English content"*.
  ([arXiv:2510.09722](https://arxiv.org/html/2510.09722v1)) See Q7 — this is a market difference, not a
  universal.
- **No published percentage** for what share of CVs carry a projects section was found in any academic
  paper, any parser vendor's documentation, or any corpus study, at any sample size.

**State it plainly: nobody has published how common a projects section is.** If a number appears in a
spec review, ask for the sample.

---

## Q2 — How is an entry actually written?

### The live reference implementation, quoted in full

JSON Resume's schema is live (see Q6) and ships three official example CVs. This is the
`senior-engineer` project entry, verbatim, from
[`packages/schema/examples/senior-engineer.resume.json`](https://github.com/jsonresume/jsonresume.org/blob/master/packages/schema/examples/senior-engineer.resume.json):

```json
{
  "name": "raft-lab",
  "description": "A teaching implementation of the Raft consensus protocol with a deterministic network simulator.",
  "highlights": [
    "Used in a graduate distributed-systems course at two universities",
    "Includes a fault-injection harness for partition and clock-skew scenarios"
  ],
  "keywords": ["Go", "Raft", "Consensus"],
  "startDate": "2019-01-01",
  "url": "https://github.com/lvasquez/raft-lab",
  "roles": ["Author", "Maintainer"],
  "type": "application"
}
```

Note what is there and what is not: **a start date with no end date** (an ongoing project), **a URL**,
**a keyword array that is the technology list**, **bullet highlights**, **roles**, and **no
organisation** — `entity` is available and simply unused. The `new-grad` example's `DormSwap` entry is
the only one of the three that fills `entity`, with `"University of Washington Capstone"`.

### The field inventory across the three systems that model a project

| Part | JSON Resume `projects[]` | LinkedIn Project | RChilli Project |
|---|---|---|---|
| Title | `name` | `title` — **required** | `ProjectName` |
| Prose summary | `description` | `description` (rich text) | — |
| Bullets | `highlights[]` | — | — |
| Technology list | `keywords[]` — *"Specify special elements involved"*, e.g. `AngularJS` | — | `UsedSkills` |
| Dates | `startDate`, `endDate` — both optional | `startMonthYear`, `endMonthYear`, `singleDate` — all optional, **no day precision** | — |
| Link | `url` | `url` | — |
| Role | `roles[]` — *"Team Lead, Speaker, Writer"* | — | — |
| Team | — | `members[]` — **required**, *"People who contributed… Required to have the member's own person URN in the array"* | `TeamSize` |
| Organisation | `entity` — optional free string | **`occupation`** → a position URN | implicit: nested under the employer |
| Kind | `type` — *"volunteering, presentation, talk, application, conference"* | — | — |

Sources: [JSON Resume schema.json](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json) ·
[LinkedIn Project Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/project) ·
[RChilli parser fields](https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields)

### Prose or bullets? Both, in different slots

JSON Resume is the only system that answers this, and its answer is **both, and they are different
fields**: `description` is *"Short summary of project"* (one sentence), `highlights` is *"Specify
multiple features"* (the bullets). All three official examples fill both.

**Our owner's entries fill only the first, at paragraph length.** MIT CAPD's guidance runs the other way
— *use bullet points to separate information into bite-sized chunks, keeping each statement to 1–2
lines*, structured as PAR statements (activity → project → result).
([MIT CAPD — Crafting an effective resume](https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/))

### Is it dated in practice? — the direct answer to ADR-0003 clause 6

**Undated is legal everywhere and required nowhere.**

- **LinkedIn**: only `id`, `title` and `members` are required. Every date field is optional. And the
  `singleDate` boolean is documented as *"A boolean that distinguishes between an ongoing project without
  an end date and a project that occurred at one specific time."*
- **JSON Resume**: no field is required at all; the `senior-engineer` example ships `startDate` with no
  `endDate`.
- **Our corpus**: 0 of 3 standalone entries dated; Thomas's nested projects dated only via their parent
  client block.

**The clause-6 conclusion:** *no date at all* is **not a fourth end-state of a range**. A job's range is
effectively mandatory and its *end* has three states. A project's **entire date block is optional**, and
on top of that LinkedIn adds a point-in-time state that a job does not have. These are different
date models, and clause 6 should not be stretched to cover both.

---

## Q3 — Where does it sit, and does it displace anything?

### The shipped answer: it can sit in two places, and one of them is inside a job

**Berkeley** states the fork explicitly — projects can be *in a "Projects" section or as part of your
"Work Experience" section*
([Berkeley Career Engagement](https://career.berkeley.edu/prepare-for-success/resumes/)). **RChilli
takes the harder line and only supports one of them**: *"RChilli only extracts project details when they
are mentioned under or within the Experience section of the resume."*
([RChilli](https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields)) A standalone `PERSONAL PROJECTS`
section is, to that parser, invisible as projects.

**Our corpus splits the same way, 1 standalone to 2 nested**, so this is not a theoretical fork — it is
the one the local evidence is already sitting on.

### Above or below work experience?

**No authoritative source prescribes an order.** MIT and Berkeley both decline to fix one. What both do
instead is treat a project as **a kind of experience rather than a separate class of thing**: MIT
advises *considering including class projects, competitions or personal projects **in addition to** jobs,
internships, UROPs or leadership roles*, and Berkeley groups *"work, research, volunteer, and/or project
experience"* as one bullet. **That framing is itself a finding for #146** — the institutions closest to
the practice put a project in the experience family, not in the evidence-for-skills family.

Our own corpus puts it **below all work experience and above skills** (Adrien), which is consistent with
"a weaker kind of experience" but is a single data point.

### Is there published guidance to drop it once you have experience?

**Yes, and the best available evidence contradicts it.**

The advice exists — university career-centre material holds that projects matter most for *recent
graduates and career changers*, and that with substantial professional experience projects become
secondary to work accomplishments
([PennWest Career Center](https://career.pennwest.edu/resources/how-and-when-to-include-projects-on-your-resume-plus-examples/)).
⚠️ That article is a syndicated careers-blog post, not institutional research; treat it as convention,
not evidence.

**The evidence that cuts against it is stronger, and it is first-party.** JSON Resume's three official
example CVs, in the live schema package:

| Example | Projects |
|---|---|
| `new-grad.resume.json` | **2** — both fully populated, with URLs and end dates |
| `senior-engineer.resume.json` | **1** — `startDate` only, no `endDate` (ongoing) |
| `career-changer.resume.json` | **0** — carries `volunteer`, `certificates` and `references` instead |

**The reference implementation gives the career changer no projects and the senior engineer one.** That
is the precise inverse of the "juniors and career changers only" rule. And it matches our own corpus:
the owner has 7+ years and carries three.

**Recommendation for #146: do not encode a seniority rule.** The only two pieces of real evidence
available — the reference implementation and our own corpus — both contradict it.

---

## Q4 — Does anyone screen on it?

### No ATS holds a structured project object

Confirmed by reading the shipped models, not the marketing.

- **Greenhouse Harvest API** — the candidate object carries `educations`, `employments`, `attachments`,
  `tags`, `custom_fields` and `keyed_custom_fields`. **There is no projects object or endpoint.**
  ([Harvest API](https://developers.greenhouse.io/harvest.html)) ⚠️ Liveness note: Harvest v1 and v2 are
  deprecated after **2026-08-31**; v3 is current.
- **Textkernel Tx Platform v10** — this is the strongest negative in the document. `ParsedResume`, read
  from the shipped C# SDK, has 25 top-level members:
  `ContactInformation, ProfessionalSummary, Objective, CoverLetter, PersonalAttributes, Education,
  EmploymentHistory, SkillsData, Skills, Certifications, Licenses, Associations, LanguageCompetencies,
  MilitaryExperience, SecurityCredentials, References, Achievements, Training, QualificationsSummary,
  Hobbies, Patents, Publications, SpeakingEngagements, ResumeMetadata, UserDefinedTags`.
  **There is no project object.** There is room for `Hobbies`, `Patents` and `SpeakingEngagements`, and
  none for projects.
  ([ParsedResume.cs](https://github.com/textkernel/tx-dotnet/blob/master/src/Textkernel.Tx.SDK/Models/Resume/ParsedResume.cs) ·
  [candidate data model](https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/))

**Where does a `PERSONAL PROJECTS` section go when Textkernel parses it?** The only plausible landing
sites are `Achievements` — typed `List<string>`, documented only as *"Any achievements listed on the
resume"* — or nothing. **A structured project entry does not survive the market-leading parser.** That
is a concrete, checkable cost of choosing the standalone shape.

### Is a project ever a filter criterion?

**No evidence found that it is, anywhere.** No ATS exposes a project field to search or filter; no
parser emits a project field that a filter could bind to (RChilli's excepted, and it is nested inside
experience). A credential is a filter criterion because it is a normalised, enumerable object; a project
is free text with a name.

**And nothing in the employer-survey literature addresses it.** NACE's *Job Outlook* surveys — the
standard primary source for what employers look for — ask about **attributes and skills**, not about
resume sections. The 2025 survey (n = 237, collected Aug–Sep 2024) reports that nearly 90% of employers
seek evidence of problem-solving and nearly 80% seek teamwork.
([NACE Job Outlook 2025](https://www.naceweb.org/docs/default-source/default-document-library/2025/publication/research-report/2025-nace-job-outlook-jan-2025.pdf))
**There is no NACE datum on projects sections.** It is not that employers rated it low; the question is
not asked.

### The circulating recruiter statistics are unusable

See *Numbers weaker than they look*. I attempted to verify the most-repeated figures and could verify
**none** of them.

---

## Q5 — Is a project evidence for a skill, or a thing in its own right?

**This is the sharpest question in #147 and the answer is that the question contains a false
dichotomy.** In every system that models a project, it is a **named object that carries the skills it
demonstrates** — which is exactly the dual nature a job already has.

### The prior art, three systems, all pointing the same way

| System | How a project relates to a job | How a project relates to skills | Liveness |
|---|---|---|---|
| **RChilli** | **Nested inside the employment block.** *"RChilli only extracts project details when they are mentioned under or within the Experience section."* Multiple projects per employer, each its own object in a `Projects` array. | **`UsedSkills` is a field on the project object.** Separately, a skill's `Evidence` field can take the value **`ProjectSection`**, alongside `ExperienceSection`, `SkillSection`, `SummarySection`, `CertificationSection`, `AchievementSection` and others. | Live, v8 |
| **LinkedIn** | **`occupation`** — *"Position a member held while working on this project. Selected from a position of the member's profile."* A URN: `urn:li:position:(urn:li:person:123ABC,677616236)`. | The product UI attaches skills to a project; **the published API schema does not carry a skills field** — see the liveness caveat below. | Product live; API doc stale |
| **Textkernel** | **Does not model projects.** | `FoundIn` is a `List<SectionIdentifier>`, and `SectionIdentifier.Id` is documented as *"If applicable, the `Position.Id` or `EducationDetails.Id`"*. **Exactly two anchors — a job and a degree. A project is not one of them.** | Live, v10 |

Sources: [RChilli parser fields](https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields) ·
[RChilli response schema](https://docs.rchilli.com/kc/c_RChilli_resume_parser_response_Schema) ·
[LinkedIn Project Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/project) ·
[SectionIdentifier.cs](https://github.com/textkernel/tx-dotnet/blob/master/src/Textkernel.Tx.SDK/Models/Resume/SectionIdentifier.cs)

### What this means for #146, concretely

1. **The mention-site pattern from #145 extends to projects — in one shipped parser, not two.**
   Textkernel's `FoundIn` anchors are jobs and degrees only. RChilli's `Evidence` enum explicitly
   includes `ProjectSection`. So "a project is a mention-site" is **real prior art, but it is one vendor,
   not a consensus**, and #145's finding that mention-sites are the "production-layer consensus" was
   about *jobs*, where it genuinely is universal. Do not over-claim it for projects.
2. **We would be adopting, not inventing — for `UsedSkills`.** RChilli ships `ProjectName` + `UsedSkills`
   + `TeamSize`. That is a project as a skill-bearing container, in production.
3. **The parent pointer is the real design object.** LinkedIn's `occupation`, RChilli's nesting, and our
   own corpus's ~21 nested entries all say the same thing: **a project's most important relationship is
   to the job it happened inside**, and the standalone case is a project whose parent pointer is null.
   That is a cleaner model than "a project has no organisation."
4. ⚠️ **`conservationIssues()` is blind to all of this.** The ticket already notes a dropped project is
   invisible to the lint. Worth adding: if projects are nested under jobs, dropping a project also
   silently reduces a job's bullet content — and per ADR-0005's warning, a bullet-for-bullet swap is
   invisible to a lint that counts fact *classes*.

---

## Q6 — What do career-data standards define a project to be?

| Standard | Project object? | Fields | **Liveness — verified 2026-08-06** |
|---|---|---|---|
| **JSON Resume** | **Yes — top-level `projects` array**, *"Specify career projects"* | `name`, `description`, `highlights[]`, `keywords[]`, `startDate`, `endDate`, `url`, `roles[]`, `entity`, `type` | **🚨 LIVE — correcting #145.** `resume-schema` (2,396★) and `resume-cli` (4,719★) are archived, **but the repo description reads "MOVED to jsonresume/jsonresume.org (packages/schema) — npm @jsonresume/schema unchanged"**. npm **v1.3.1 published 2026-07-22**. Monorepo pushed 2026-07-29. `registry-server` genuinely dead (archived, last push 2019-12-26). |
| **LinkedIn** | **Yes** — `Projects`, a **Recommended** profile section | `id`, `title` (req), `members[]` (req), `description`, `url`, `startMonthYear`, `endMonthYear`, `singleDate`, `occupation` | **Product live** (LinkedIn Help, current). ⚠️ **API documentation stale**: Project Fields page carries `ms.date: 2020-09-01`, `updated_at: 2021-10-11`; the Projects sub-resource page `ms.date: 2021-05-31`, `updated_at: 2022-04-06`. The Profile Edit API is partner-restricted. **The doc predates the product's associated-skills feature**, which is why no skills field appears in the schema above. |
| **RChilli** | **Yes — nested inside Experience** | `ProjectName`, `UsedSkills`, `TeamSize` | Live, v8, active release notes |
| **Europass** | **Optional add-on only** | Not specified as a structured object in any primary page I could reach | Platform live. Projects sit outside the basic profile (*"education and training, work experience, language skills, digital skills"*) |
| **HR Open Standards** | **No project object found** | — | **Live — 4.6 Candidate Release updated 2026-05-08**; Trusted Career Profile released 2026; Skills Proficiency Data API Schema pre-released 2026-01-21 |
| **Textkernel Tx v10** | **No** | — | Live |
| **Greenhouse Harvest** | **No** | — | Live (v1/v2 deprecated after 2026-08-31) |

### Two liveness corrections this map needs

**1. JSON Resume — the important one.** #145 recorded it as fully archived and #147's brief repeated
that. **It is not.** The archive was a **relocation into the `jsonresume.org` monorepo**, the npm package
is publishing (v1.3.1, 2026-07-22), and the schema is live. This matters directly: **JSON Resume is the
only standard with a first-class top-level `projects` array**, so if it were dead, projects would have no
live standard home at all. It has one.

⚠️ **The lesson worth writing down: `archived: true` on GitHub is not evidence of abandonment.** It was
read that way twice on this map. Check the repo description and the package registry before concluding a
standard is dead.

**2. HR Open Standards.** The brief describes prior research finding *"HR Open's newest repo from 2022"*.
The **GitHub repos** may well be stale, but the **standard is not** — 4.6 documentation updated
2026-05-08, with 2026 announcements. This repo's own
[`skill-shape-granularity-normalisation-levels.md`](skill-shape-granularity-normalisation-levels.md)
already records this correctly; the stale framing survives in ticket summaries, not in the research.

---

## Q7 — The non-technical case

**A projects section is not a developer convention. But it is also not universal — it is bounded by
market and by profession, and the boundary is not the one the ticket guessed.**

### Our corpus contradicts "developer-only" directly

The CV with the most project content in the corpus by an order of magnitude is **Thomas Chauviere's —
a façade-engineering draughtsman and chef de projet in Swiss construction**, with ~19 named projects. The
one standalone `PERSONAL PROJECTS` section belongs to an **IT project manager**, not a developer. And the
two most technical CVs in the corpus — **Remy IM** (IT system analyst, 8 years, C#/SQL/Power Platform)
and **Kulpakorn Ngamvijit** (senior business analyst) — carry **no project entries at all**.

**The split in our corpus is not technical vs non-technical. It is project-delivery professions vs
everything else.** Both CVs carrying project entries belong to people whose job title contains the word
*project* or *chef de projet*. That is a materially different rule, and it is one that **includes** our
IT-PM/banking market rather than excluding it.

The two genuinely non-technical CVs behave differently again: **Giuliana Delre** (purchasing) carries one
project-like item — a **thesis under Education** — and **Pierre Mounier** (customer success) carries
none, using `Travel` and `Interests` where a projects section might sit.

### Externally: it is a market convention, and the market matters

- **China**: *project experience* is a first-class extracted category in production. Alibaba's CaiMi HR
  platform extracts *basic information, work experience, **project experience**, and education
  background* from 13,100 real, mixed Chinese-English resumes.
  ([arXiv:2510.09722](https://arxiv.org/html/2510.09722v1))
- **English-language academic corpora**: no projects label at all (see Q1's caveat).
- **Europe**: Europass places projects outside the basic profile, as an optional addition.
- **US institutional guidance**: projects are folded into the experience family (MIT, Berkeley).

### Hong Kong and Singapore specifically — no usable evidence

⚠️ **I could not find a single high-trust primary source on HK or SG CV conventions.** Every result was
SEO or AI-generated careers content. What those low-trust sources agree on is that the expected sections
are *Work Experience, Education, Skills, Languages* — **with no projects section named** — which is
consistent with our 0-of-17 advert sweep but is **not independently established** and should not be
cited.

**The honest position for #146:** our own advert corpus says zero of 17 postings mention projects,
portfolios, GitHub, side projects or open source. That is the only real evidence about our market, and
it points the same way as the absence of HK/SG guidance. **It remains possible this is a property of an
IT-PM/banking corpus rather than of the region** — the ticket flagged that risk and nothing found here
resolves it.

---

## What I could not establish, and why

**1. Any percentage for how common a projects section is.** No academic corpus, parser vendor, or study
publishes one, at any sample size. This is a genuine void, not a search failure — see Q1.

**2. Whether any recruiter or hiring manager actually screens on projects.** No ATS exposes the field;
NACE does not ask the question; every circulating percentage failed verification.

**3. RChilli's full project object.** The parser-fields page confirms `ProjectName`, `UsedSkills` and
`TeamSize` nested inside Experience. **It does not document whether a project carries dates, a URL, or a
description**, and the RChilli helpdesk article that would answer it returns **HTTP 403** to automated
fetch. If the project element's exact shape matters to a build ticket, get an RChilli key and parse
Thomas's CV — it is the ideal test document.

**4. The Europass project object's fields.** Europass names projects as recordable but I could not reach
a primary page enumerating a structured project entry's fields. The current platform's editor is
JavaScript-rendered. The legacy ECV XML schema documentation is a 4.3MB image-based PDF that yielded no
extractable text.

**5. Whether LinkedIn's Project object currently carries a skills field.** The product UI does attach
skills to a project — this is consistently reported — but **the published API schema does not contain
one and dates from 2020–2021**. I am not asserting the field exists in the API. What is primary and
solid is `occupation`, the pointer to a position.

**6. The English Resume Corpus label list, read from the paper.** The seven-label list in Q1 comes from
search summaries; the PDF would not yield text. Flagged in place.

**7. Whether a standalone projects section hurts anything.** No evidence found either way that a projects
section is read as a warning sign, filler, or a negative signal. The claim is neither supported nor
refuted by anything primary.

---

## Numbers weaker than they look

Every widely-circulated statistic about projects and hiring failed verification. This section exists so
nobody re-finds them and treats them as new.

- **"38% of engineering leaders rank side projects the top hiring criterion" (attributed to CodePath,
  2025, 200+ engineering leaders).** I searched CodePath's own domain directly. The figure **does not
  appear** in CodePath's Class of 2025 report or its employer materials as far as those are reachable;
  CodePath's published Class-of-2025 figures are about **students**, not engineering leaders.
  **Unverified — do not use.**
- **"71% of hiring managers consider a candidate's GitHub activity, per a Stack Overflow survey."** No
  such question appears in any Stack Overflow Developer Survey I could locate. The claim propagates
  across AI-generated careers blogs with no citation. **Unverified — do not use.**
- **"80% of hiring managers value personal projects" / "76% say portfolio work can outweigh formal
  education" / "nearly 60% prioritise collaborative or open-source projects."** All three trace to SEO
  content farms (`resumly.ai`, `priygop.com`, `careerproguider.com`, `techotlist.com`, `airesume.guru`)
  citing one another. **No sample, no method, no year, no source. Unusable.**
- **HK/SG CV convention guidance.** Every source found was SEO or AI-generated. **Not cited above except
  as an explicit absence of evidence.**

**The pattern is worth naming:** projects-on-a-CV is a high-traffic SEO keyword, so the search space is
unusually polluted. The signal in this area came almost entirely from **reading shipped code and
schemas**, not from searching.

---

## Sources, with liveness

**Live and safe to build against**

- **JSON Resume** — 🚨 **live, correcting #145.** Schema relocated to
  `jsonresume/jsonresume.org/packages/schema`; npm `@jsonresume/schema` **v1.3.1, 2026-07-22**; monorepo
  pushed 2026-07-29. Archived-and-moved: https://github.com/jsonresume/resume-schema ·
  Schema: https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json ·
  Live examples: https://github.com/jsonresume/jsonresume.org/tree/master/packages/schema/examples
- **Textkernel Tx Platform v10** — live. `ParsedResume` (no project object), `SectionIdentifier`
  (`Position.Id` or `EducationDetails.Id`), `ResumeSkill.FoundIn`.
  SDK source: https://github.com/textkernel/tx-dotnet/tree/master/src/Textkernel.Tx.SDK/Models/Resume ·
  Data model: https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
- **RChilli v8** — live. Project object (`ProjectName`, `UsedSkills`, `TeamSize`) nested in Experience;
  skill `Evidence` includes `ProjectSection`.
  https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields ·
  https://docs.rchilli.com/kc/c_RChilli_resume_parser_response_Schema
- **LinkedIn** — `Projects` is a **Recommended** profile section, product live.
  https://www.linkedin.com/help/linkedin/answer/a540837/add-sections-to-your-profile
- **Greenhouse Harvest API** — live; no projects object. ⚠️ v1/v2 deprecated after **2026-08-31**.
  https://developers.greenhouse.io/harvest.html
- **HR Open Standards** — live; **4.6 Candidate Release updated 2026-05-08**. No project object found.
  https://www.hropenstandards.org/standards
- **Europass** — live; projects sit outside the basic profile.
  https://europass.europa.eu/en/how-complete-my-europass-profile

**Live product, stale documentation — cite with the caveat**

- **LinkedIn Profile Edit API — Project Fields.** Complete field table, but `ms.date: 2020-09-01`,
  `updated_at: 2021-10-11`; API is partner-restricted; predates the product's associated-skills feature.
  https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/project ·
  https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-edit-api/projects

**Institutional career guidance — primary, but convention rather than evidence**

- **MIT CAPD** — projects as a kind of experience; PAR bullets, 1–2 lines.
  https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/
- **Berkeley Career Engagement** — *"work, research, volunteer, and project experience"*; projects in
  their own section **or** inside Work Experience.
  https://career.berkeley.edu/prepare-for-success/resumes/
- **NACE Job Outlook 2025** — n = 237, collected Aug–Sep 2024. Attributes and skills only; **no datum on
  resume sections.**
  https://www.naceweb.org/docs/default-source/default-document-library/2025/publication/research-report/2025-nace-job-outlook-jan-2025.pdf

**arXiv, not peer-reviewed**

- **"Layout-Aware Parsing Meets Efficient LLMs", arXiv:2510.09722.** Alibaba CaiMi; RealResume 13,100
  real resumes, *"mixed Chinese-English content"*; extracts **project experience** as one of four
  categories. Already cited in this repo for its source-text verification step.
  https://arxiv.org/html/2510.09722v1
- **"Construction of English Resume Corpus", arXiv:2208.03219.** Seven annotation labels, **no projects
  label**. ⚠️ Label list from search summaries; **PDF not read directly.**
  https://arxiv.org/abs/2208.03219

**Checked and rejected as sources**

- CodePath "38% side projects" figure — unverified against CodePath's own domain.
- "71% of hiring managers / Stack Overflow survey" — no such survey question found.
- `resumly.ai`, `priygop.com`, `careerproguider.com`, `techotlist.com`, `airesume.guru`,
  `resumeoptimizerpro.com` — AI/SEO content farms, mutually citing, no samples or methods.
- All HK/SG CV-convention guides found — SEO content, none authoritative.

**Prior research this builds on (do not re-derive)**

- [`skill-shape-granularity-normalisation-levels.md`](skill-shape-granularity-normalisation-levels.md)
  — Textkernel `FoundIn` as mention-site; RChilli `Evidence`; the Alibaba source-text verification
  pattern; HR Open 4.6 liveness (already correct there).
- [`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md) — the standards
  survey that omitted projects, which #147 exists to fill.
- [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
  — §2.2, no ATS stores a structured skill object; the same now confirmed for projects.
