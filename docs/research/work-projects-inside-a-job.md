# A project done for an employer: does it get its own named entry inside the job, or stay a plain bullet?

_Deep-sources half of the research for [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150),
under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127). Unblocked by
[ADR-0006](../adr/0006-a-project-is-a-container-not-a-fact.md), which decided the **personal** project
and explicitly deferred this one. Siblings [#147](https://github.com/adrien-mounier/jobcrush-app/issues/147)
(the personal project entry) and [#148](https://github.com/adrien-mounier/jobcrush-app/issues/148) (the
umbrella section name) are closed and their outputs are in this folder. Written 2026-08-06._

_A `/last30days` companion covers recent practitioner movement. This half covers established, high-trust
primary sources: shipped schemas read from source, live parser SDKs and API docs, official platform
documentation, institutional career-service guidance, published corpora, and the repo's own CV corpus._

**What this document is not.** It is not about **personal** projects — a personal project has no employer
by definition, [ADR-0006](../adr/0006-a-project-is-a-container-not-a-fact.md) owns it, and the owner has
already caught one session conflating the two. It does not re-derive
[`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md),
[`projects-umbrella-section-naming.md`](projects-umbrella-section-naming.md),
[`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md) or
[`skill-shape-granularity-normalisation-levels.md`](skill-shape-granularity-normalisation-levels.md).
Where it corrects one of them — or corrects the ticket — it says so loudly.

---

## Bottom line

**1. 🚨 The ticket's description of the corpus is wrong in the one detail the design hangs on: not a
single named project in the corpus carries a date of its own.** #150 says Thomas Chauviere's `Projets:`
entries carry *"a client, dates and their own bullets"*. Read at source, all three parts are attached to
different things. **Dates belong to a `(client)` block, never to a project** — 0 of 18 named projects has
a date; 2 client blocks do. **A client appears in one of his eight jobs**, not throughout. And **10 of
the 18 named projects have no bullets at all** — they are five names on one comma-separated line. The
rich shape the ticket describes (name + client + dates + bullets) exists in the whole corpus **four
times**, all inside one job of one CV. See [the corpus](#the-local-corpus--read-first-hand-before-any-searching).

**2. 🚨 The 7:1 count is real but it is one document, and that document is outside our market and our
profession.** #147 counted ~3 standalone against ~21 nested. Recounted here: **~18 of the ~22 nested
project mentions come from Thomas Chauviere alone** — a façade-engineering draughtsman in France and
Switzerland. Across the **five** CVs that sit in our actual market (banking/IT-PM, Bangkok · Paris ·
Singapore · Lisbon), the number of named project sub-entries with a client, dates and their own bullets
is **zero**. Those CVs name work projects too — inside a bullet (`Chatbot FINDER: Coordinated development
of a chatbot…`), in parentheses (`a trading platform (Lao Forex Exchange)`), or **as a suffix on the job
title** (`Business Analyst - Banking Mobile Application`). The bullet is what our market already does.

**3. The nesting mechanism is shipped and live in the market-leading open-source builder — and it holds
roles, not projects.** Reactive-Resume (40k★) added `roles[]` inside an experience item on **2026-03-04**:
*"List of individual roles held at this company to show career progression."* Each role carries `position`,
`period` and `description` — precisely the named-sub-entry-with-its-own-dates-and-body shape #150 proposes.
The same schema keeps `projectItemSchema` as a **separate top-level section** with no employer field at
all. When a shipping tool decided a job needed sub-entries, it chose promotions.

**4. Exactly one live parser nests a project inside a job, it requires the employer anchor, and it stores
neither the client nor the dates.** RChilli's `Projects` array sits inside `SegregatedExperience`, under
each employer block, and holds three keys: `"UsedSkills"`, `"ProjectName"`, `"TeamSize"`. Its helpdesk
adds that *"the project timeline must fall within the employment period"* and that project data with no
linked employer **is not captured at all**. So the market's one nested-project model **reads** a project's
dates as a validity check and **emits** no date field. Building a client and a date on a nested project
means building past every parser that exists.

**5. Everyone else either makes a project a top-level peer of a job, or has no project at all.** Read at
source: **JSON Resume** — `projects` is top-level, `work[]` has no nested projects field, and the only
employer link is an optional free string `entity` (*"Specify the relevant company/entity affiliations"*).
**LinkedIn** — projects are a separate collection at `/v2/people/id={person ID}/projects`, pointing back
at a job via `occupation`: *"Position a member held while working on this project"*, sample value
`"urn:li:position:(urn:li:person:123ABC,677616236)"`. **Daxtra** — `ProjectHistory` at the resume root,
plus a `Project` *inside* a position that is **`[0..1]` and a string**, parked in the vendor extension
area. **HR-XML 2.5 contains the word "project" zero times.** **Textkernel** — a position holds one plain
`Description` and the model has no project member. **Europass** — `Projects` is a top-level profile
section. **Greenhouse, Lever, Workday, SuccessFactors, Oracle** — no candidate-facing project entry found
anywhere (SuccessFactors' `Background_SpecialAssign` holds project assignments as a **peer** background
element, not inside work experience).

**6. Naming it buys nothing in matching, and this is checkable in our own code rather than argued.** The
judged score is the only mechanism a project can reach ([ADR-0006](../adr/0006-a-project-is-a-container-not-a-fact.md)
clause 9). `buildJudgeInput()` (`apps/api/src/judge.ts:66-75`) hands the model a flat list of
`- id: … / text: …` lines. **It passes no employer, no job, no dates, no grouping — not even which role a
sentence belongs to.** A project container would be invisible to the grader today, and so is the job
container. Naming a project changes nothing the matcher can see.

**7. So the honest answer to "does naming it buy anything a bullet does not?" is: on the page, sometimes.
Everywhere else, no.** No ATS exposes a project as a search or filter field; no parser except RChilli emits
one; nothing in our 17-advert corpus asks for named projects (16 of 17 use the word *project*, all of them
about the job on offer). The one non-cosmetic gain found anywhere is RChilli's skill `Evidence` enum,
which includes `ProjectSection` — a skill can record that it was demonstrated in a project. That is a
**skill** feature, and #147 already established it is one vendor, not a consensus. **The rest is
presentation, and presentation belongs to the design effort, not to this map.**

**8. It is not free today, and it is not free for the reason ADR-0001 names.** Carving a named container
out of what are today job bullets is the **employer case** — ADR-0001's own stated limit. It is cheap
*right now* only because [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126)'s job record
does not exist, so there is nothing yet to migrate. Concretely: the miner's `role` field is a **free
string** (`packages/contracts/src/candidateClaims.ts:31`), so a project name could be written into it
today at **zero contract cost** — but `MinedRole` requires `employer` and `title`
(`candidateClaims.ts:10-15`), the Draft has no project or client slot, and `conservationIssues()` watches
neither. **The cheap version is a naming convention inside an existing string; the expensive version is a
new part on the job record, and only the first is free.**

**9. 🚨 The real hazard in this corpus is not the project. It is the client.** Thomas's
`ASSYTEM (client) - 02/2021 - 05/2021` and `TRACTEBEL (client) - 10/2018 -12/2020` are **name + date
range nested inside an employer** — byte-for-byte the shape of an employment block. ADR-0006 clause 5
forbids a *project* reaching `roles[]`; **nothing anywhere forbids a client doing it**, and the client is
the one that looks exactly like a job. If it lands, the CV prints two employers he never worked for and
his career total is unaffected only by luck. The saving grace today is accidental: `MinedRole.title` is
`z.string().min(1)`, and a client block has no title — so the contract rejects the fabrication rather
than a rule catching it.

**10. The cheap answer survives contact with the evidence.** Leave them as bullets. The owner's own
framing — *"a detail, but worth checking how we want to design it"* — is supported by every source read
here: the richer nested model is one vendor with three fields, the corpus supplies no dates to fill,
the market's own professional body never asks for a project name, and the matcher cannot see grouping.
**The one thing worth doing is small and is not a new element**: make sure the project *name* survives
into the bullet, and make sure a `(client)` line never becomes an employer.

---

## The local corpus — read first-hand, before any searching

All six PDFs in `data/cvs/` were re-read from their text layer for this document (extracted with the
repo's own `pdf-parse` seam, `apps/api/src/extract.ts:28-45`). #147 counted them for the *personal*
project; this recount is for the **work** project, and it disagrees with the ticket.

⚠️ **Extraction caveat.** Thomas Chauviere's CV is a three-column layout, so the text layer interleaves
columns. Job headings, client blocks and project headings are unambiguous; **the attribution of a few
bullet runs to a specific project heading is inferred from ordering** and is not asserted below where it
matters.

### Who names a project inside a job

| CV | Market / profession | Named project sub-entries inside a job | How a work project is named instead |
|---|---|---|---|
| **Thomas Chauviere** — draughtsman / chef de projet, façade + civil engineering, FR + CH | Construction | **YES — 18 named projects across 8 jobs**, in two distinct shapes | — |
| **Adrien Mounier** — Senior PM, banking IT, Bangkok | IT-PM | **No.** `Project Achievements` is a **label for a second bullet list**, not a project entry | Name fused into the bullet: `Chatbot FINDER: Coordinated development of a chatbot…`; `CRM Data Pipeline Optimization: Supported delivery of…`; in parentheses: `a trading platform (Lao Forex Exchange)`; product name inline: `Built Ship24.com from scratch…` |
| **Kulpakorn Ngamvijit** — Senior BA, banking IT, Bangkok (Accenture, Bred IT) | IT-BA | No | **Engagement encoded as a title suffix**: `Business Analyst - Banking Mobile Application`, `Senior Business Analyst - Mobile Banking and Web Application` |
| **Giuliana Delre** — Purchasing Manager, Bangkok | Non-technical | No — `Context:` paragraph + `Key Achievements:` list per role | Phase encoded as a title suffix: `Purchasing & Supplier Scheduling Supervisor - Industrial Ramp-Up Phase`; project named inside a bullet: `Managed packaging sourcing and mold-development project` |
| **Remy IM** — IT System Analyst, Paris + Singapore (incl. Solutec, a consultancy) | Technical IT | No | Technology list in parentheses on nearly every bullet: `(C#, XrmToolBox, Git)`. **Clients never named at all** |
| **Pierre Mounier** — Customer Success, Lisbon | Non-technical | No — `Key Responsibilities` + `Achievements and Skills` sub-headings | — |

**Counts, corrected:**

- CVs with **genuine named project sub-entries inside a job: 1 of 6** — not 2. #147's table listed Adrien
  as a second, on the strength of his `Project Achievements` sub-block. Read line by line, that block
  contains **no project entries**: it is a second bullet list under a different label — 13 bullets across
  his three jobs, of which **2 carry a name prefix** (`Chatbot FINDER:`, `CRM Data Pipeline
  Optimization:`) and 11 do not.
- **Named work-project mentions corpus-wide: ~22.** **18 are Thomas's.** The remaining ~4 are Adrien's
  inline names. The ticket's ~7:1 nested-to-standalone ratio holds, and **it is one document**.
- 🚨 **CVs in our served market (HK / SG / VN / AU, plus the European feeders) with a named project
  sub-entry carrying a client, dates and bullets: 0 of 5.**

### The pattern the corpus actually shows: a job has two bullet lists, not sub-entries

**Three of six CVs split a job's body into two labelled lists**, and none of them is a project list:

- **Adrien** — the plain bullets, then `Project Achievements`.
- **Giuliana** — a `Context:` paragraph, then labelled bullets (`• Strategy:`, `• Team:`, `• Cost
  control:`), then `Key Achievements:`.
- **Pierre** — `Key Responsibilities`, then `Achievements and Skills`.

This is the **responsibilities-vs-achievements** split, and it is the shape most easily mistaken for a
nested project list. If a future session sees `Project Achievements` in Adrien's CV and reads it as
evidence for named project entries, it will have built the wrong thing. It is a heading over a bullet
list, and its contents are bullets.

### Anatomy of Thomas's 18 named projects — the only real instance in the corpus

**Shape A — the roll-up line (10 of 18, no bullets).** One line under the job heading, several projects,
each with a parenthetical descriptor and nothing else. Verbatim, FACETEC:

```
Projets: Grands Bois (travaux de façades de 3 Villas) ; Vieusseux (rénovation de façades d'une tour
de 15 étages) ; Raffeisein (rénovation de façades de bureau) ; Croisette 12 (rénovation de façades
d'une tour de 6 étages); La Combaz A9 (travaux de façades de deux bâtiments)
```

Five projects, one line, no dates, no bullets, no link, no client. The same shape at Groupe Gottburg
(Dorigny · Bulgarie · Bassenges · Sierre · Cully).

**Shape B — the project as a heading with its own bullets (8 of 18).** Verbatim:

```
Projet: EPR UK1221 - Ferraillage d'enceinte interne d'une centrale nucléaire sur Tekla
Projet: BARRACUDA – Refonte d'une base sous-marine (DDT et PLA AVP) sur Revit
Projet: « L14 Sud, Pont de Rungis » - Extension de la ligne 14 Sud, construction de gares ferroviaires sur Revit
Projet: « Logement pour le client ICF La Sablière » - Construction de logements de fonction
```

Each carries **a technology in the title itself** (`sur Tekla`, `sur Revit`, `sur Autocad`), and those
three all reappear in his `Logiciels` section — the mention-site property #147 already recorded.

**The parts table, and the correction it contains:**

| Part | Present in Thomas's 18 named projects |
|---|---|
| Name | **18 / 18** (a 19th project line is unnamed: `Projet de construction deux bâtiments de logements`) |
| Own bullets | **8 / 18** |
| **Own dates** | **0 / 18** 🚨 |
| Client, as a separate labelled level | **4 / 18** — and only inside **one** of his eight jobs |
| Client, named inside the project title | **1 / 18** — `« Logement pour le client ICF La Sablière »` |
| Link | **0 / 18** |
| Technology named in the title | **8 / 18** (all of shape B) |

**The dates are on the client, not the project.** Verbatim, inside the employer `BTM CONSULTANT, Lyon,
France 10/2018 - 05/2021`:

```
ASSYTEM (client) - 02/2021 - 05/2021
TRACTEBEL (client) - 10/2018 -12/2020
```

Those two ranges partition the employer's range exactly. The projects hang beneath them and carry no
date of their own. **So the CV with the most project content in the corpus supplies zero values for a
project date field, and the thing that genuinely wants dates is a client engagement — a different
element, present in one job of one CV.**

**And the hierarchy is four levels deep, not two:** `employer → client → project → bullets`. Any design
that assumes `job → project` cannot represent the one real example we have without flattening something.

---

## What the pipeline preserves and loses today — verified, not repeated

The ticket asserts *"nothing is lost at the sentence level"* and that the **grouping** plus Thomas's
**client and dates** are lost. Checked against the code:

**Confirmed lost — the grouping.** A claim's only structural slot is `role`, documented in
`packages/contracts/src/candidateClaims.ts:31` as `// employer+title as written, or "profile"`, and
`apps/api/prompts/claim-miner.md` rule 6 says the same. There is nowhere to record that four bullets
belonged to `BARRACUDA`.

**Confirmed lost — the client.** The strings `client` and `project` appear **nowhere** in
`claim-miner.md`, `preview-tailor.md` or `root-cv-audit.md` except one skill-group example. `MinedRole`
holds `employer`, `title`, `dates_as_written`, `dates_missing` and nothing else. `Draft.experience[]`
holds `role`, `employer`, `location`, `dates`, `bullets` (`apps/api/src/preview.ts:110-121`). A client
has no home in either.

**Confirmed lost — the client's dates**, as a consequence of the above.

**Not confirmed — "nothing is lost at the sentence level".** ⚠️ **This is weaker than the ticket states,
and it is worth knowing before anyone leans on it.** Two gaps:

1. **A project heading is not obviously a claim.** Miner rule 8 requires every *section* to be mined and
   names skill inventories, language lines, certification lists and education entries. It says nothing
   about a sub-heading inside a job. Whether `Projet: BARRACUDA – Refonte d'une base sous-marine…`
   survives as a claim is **undefined behaviour, not a guarantee** — and it is the line carrying the name
   and the technology.
2. **The origin pointer is capped below the length of a roll-up line.** `source_quote` is
   `z.string().min(1).max(200)` (`candidateClaims.ts:34`). The FACETEC `Projets:` line is ~270 characters.
   Mined as one claim, its origin quote **cannot** hold the exact source words that
   [ADR-0004](../adr/0004-each-elements-own-parts.md) clause 1a requires. Mined as five atomic claims
   (rule 1 would allow it) each fits — so this depends on a behaviour nothing pins.

**Also lost, and not in the ticket:** the Draft caps a role at **8 bullets** and the CV at **10 roles**.
Thomas has 8 jobs; his `BARRACUDA` project alone has ~11 bullets. **His nested structure cannot render
today at any level of fidelity**, before any decision about naming is taken. And Adrien's Okoone entry
has a nested sub-bullet list (`Platform performance in 2023: ○ 16M website visitors …`) that a flat
`bullets: string[]` also flattens.

---

## Q1 — Do CVs actually name projects inside a job, and is there guidance either way?

### Prevalence: one document in our corpus, and no published number anywhere

#147 established that **no published figure exists** for how common a projects section is, at any sample
size, in any academic paper or vendor document. Nothing found here changes that, and no separate figure
exists for the nested case either. The search space is the same SEO-polluted one #147 documented.

**What can be said from primary evidence:** the nested named project is real, it is concentrated, and in
this corpus it is a **profession** signal rather than a market one — the person carrying 18 of them has
*chef de projet* in his title and works in construction, where a project has a client, a site and a
name that outlives the job. #147 reached the same conclusion from the standalone side (*"project-delivery
professions vs everything else"*), and this recount strengthens it: our own IT project managers and
business analysts, whose titles also contain *project*, **do not** use named sub-entries. They use
bullets and title suffixes.

### Institutional guidance: the structure prescribed is company + title + dates + bullets, full stop

- **Purdue OWL — Work Experience Section.** The prescribed entry is *"names of the companies you worked
  for"*, *"city and state for each company"*, *"titles/positions you held"* and *"your employment dates
  for each job"*, then *"a bulleted list of the duties you performed"* with *"a minimum of three bulleted
  items with the most relevant duties listed first"*. **Projects, sub-headings and named sub-entries
  inside a job are not mentioned at all.**
  ([Purdue OWL](https://owl.purdue.edu/owl/job_search_writing/resumes_and_vitas/resume_sections/work_experience_section.html))
- **Carnegie Mellon, SCS Graduate Resume Guide (2023)** — the sharpest source found, because it shows the
  authors *knew* the nesting option and withheld it. Projects get a **section of their own**: *"Include a
  select number of academic and/or research projects on the resume."* The example is
  `ACADEMIC PROJECTS / Intelligent Indoor Emergency Response System — Carnegie Mellon University | April
  2023`, with bullets. Then, two sections later: *"Publications can be listed in a separate section if
  numerous, **or under the relevant research/work experience**"*, and the identical sentence for
  Conferences. **The guide offers the nested option twice and never for projects.**
  ([CMU SCS Graduate Resume Guide](https://www.cmu.edu/career/documents/sample-resumes-cover-letters/scs_graduate_resume_guide_2023.pdf))
- **Berkeley Career Engagement** — projects can sit *in a "Projects" section or as part of your "Work
  Experience" section*. This is the one institutional source that permits the nested case, and it permits
  it as **part of** work experience, not as a named sub-entry with its own heading. (Established in #147;
  [Berkeley](https://career.berkeley.edu/prepare-for-success/resumes/))
- **MIT CAPD** — projects as a kind of experience, PAR bullets, 1–2 lines each. (Established in #147;
  [MIT CAPD](https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/))

### The professional body for exactly this market never asks for a project name

**APM (Association for Project Management)** is the closest thing to a governing body for our users'
profession, and its own CV guidance is a clean negative:

- Career history: *"They want to know what you do/did, who you manage (numbers), what is your budget
  responsibility, methodology used, types of project managed, etc."*
- Career highlights: *"Include success stories of projects managed. Employers want to know figures; they
  want to see information on size of budget, scale of team, length of projects, complexity and importance
  to the organisation."*
- The only structural requirement is about the **job**: *"the company name, job title, date started and
  date finished"* — *"It's not enough to put in just the year. Employers need to know months too."*

**It asks for budget, team size, methodology, project type and length — all of which fit in a bullet —
and never for a project's name, its client, or its dates.**
([APM — 10 tips for writing a winning project management CV](https://www.apm.org.uk/jobs-and-careers/tips-for-writing-a-winning-cv/))

⚠️ **PMI:** I searched PMI's own domain for equivalent CV guidance and found none reachable. **This is
"could not check", not "checked and found nothing"** — PMI publishes career material behind member
access. Do not record PMI as silent on the question.

### What advises *for* the nested named project

**Only SEO careers content**, and #147 already established that this keyword space is dominated by mutually
citing content farms. The "add a *Relevant Projects* subheading under each employer" advice appears across
zety, novoresume, beamjobs, themuse and similar; **no institutional or professional-body source found here
gives it.** It is recorded as an observed convention with no authority behind it, and the `/last30days`
companion is the right place to weigh how loud it currently is.

---

## Q2 — Does any parser or standard model a project *inside* a position?

**The crux, answered.** Sorting every system read at source into the three cases the ticket asked for:

| System | (a) Project as a top-level peer of a job | (b) Project **nested inside** a position | (c) No project model | Liveness |
|---|---|---|---|---|
| **RChilli v8** | — | ✅ **Yes — the only one** | — | Live |
| **Daxtra 2.0.40** | ✅ `ProjectHistory`, typed `EmploymentHistoryType` | ⚠️ **Yes, but as a `[0..1]` string in the vendor extension slot** | — | Live |
| **JSON Resume** | ✅ top-level `projects[]`, `work[]` has no projects field | ❌ | — | Live (v1.3.1, 2026-07-22, per #147) |
| **LinkedIn** | ✅ separate collection + a pointer back at a position | ❌ | — | Product live; API doc 2020–2022 |
| **Europass** | ✅ `Projects` is a profile section | ❌ | — | Live |
| **Reactive-Resume 40k★** | ✅ top-level `projects` section | ❌ **— but it nests `roles[]` inside an experience** | — | Live, `roles` added 2026-03-04 |
| **yamlresume** | ✅ top-level `projects` | ❌ | — | Live |
| **rendercv** | — | ❌ | ✅ no project entry type | Live |
| **HR-XML 2.5 / HR Open** | — | ❌ | ✅ **the word "project" appears zero times** | HR-XML 2.5 legacy; HR Open 4.6 not reachable (see below) |
| **Textkernel Tx v10** | — | ❌ | ✅ no project object | Live |
| **Greenhouse · Lever · Workday · SuccessFactors · Oracle** | — | ❌ | ✅ no candidate-facing project entry found | Live |

### The one that does it: RChilli

Read from the shipped response schema, the `Projects` array sits **inside each experience object**, and
this is the whole object:

```json
"Projects" : [ {
  "UsedSkills" : "",
  "ProjectName" : "",
  "TeamSize" : ""
} ]
```

([RChilli — Segregated Experience schema](https://docs.rchilli.com/kc/resume%20parser%20schema/c_Resume_parser_schema_Segregated_Experience.html) ·
[parser fields](https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields))

Three keys. **No date. No client. No description. No link.** And the extraction rules, from RChilli's own
helpdesk article, confirm the nesting is not incidental but required:

- *"RChilli only extracts project details when they are mentioned under or within the Experience section
  of the resume."*
- *"the project timeline must fall within the employment period"*
- *"If a resume only contains project data without any linked employer or job profile, project information
  will not be captured, as a valid Employer + JobPeriod combination is necessary to anchor the project
  information."*
- *"supports parsing multiple projects per employer, with each parsed into a separate object in the
  Projects array"*

⚠️ **Sourcing caveat, stated plainly.** The helpdesk page
([help.rchilli.com/hc/en-us/articles/900005421063](https://help.rchilli.com/hc/en-us/articles/900005421063-How-does-RChilli-parse-the-project-details-in-a-resume))
returns **HTTP 403** to automated fetch — the same wall #147 hit. The quotes above come from search-engine
indexing of that page, **not from the page read directly**. The *structural* claim (Projects nested in
`SegregatedExperience`, three keys) **was** read directly from the schema page and is solid.

**The finding that matters:** the market's only nested project model **reads** a project's dates and uses
them to validate the nesting, then **throws them away**. It stores a name, the skills used, and a team
size. Thomas's client and dates do not survive RChilli either.

### The one that does both: Daxtra, and the split is instructive

Daxtra ships **two** places for a project, added in the same schema release (2.0.31, 2015-10-06), and the
difference between them is the whole answer:

- **`ProjectHistory`** at the `StructuredXMLResume` root, typed **`EmploymentHistoryType`** — i.e. a
  top-level peer of employment that **reuses the employment shape** (`EmployerOrg` → `PositionHistory`).
  A structured project there is modelled as a job.
- **`Project`** inside `DaxPositionHistoryUserAreaType` — the `UserArea` vendor-extension slot hanging off
  a `PositionHistory`. Verbatim from the schema documentation:

  ```xml
  <Umbrella> xs:string </Umbrella> [0..1]
  <Project> daxtraStringWithIDs </Project> [0..1]
  <TLSPAN … /> [0..10]
  <MonthsOfWork> xs:int </MonthsOfWork> [0..1]
  ```

  **`[0..1]`. A string.** One project name per position, no parts, no repetition, and parked in the slot a
  schema reserves for things it does not want in the standard structure.

([Daxtra Candidate Profile Schema 2.0.40](https://cvxdemo.daxtra.com/cvx/cvx_schema/candidate/index.html))

**Read as a design decision by people who parse CVs for a living:** when a project needs structure, it
becomes a top-level thing shaped like a job. When it sits inside a job, it is a string.

### The one that nests something else: Reactive-Resume

The most-starred open-source CV builder added nested sub-entries to an experience item on **2026-03-04**
(*"feat(experience): add role progression to show career advancement within a company (#2761)"*). Verbatim
from `packages/schema/src/resume/data.ts`:

```ts
const roleItemSchema = z.object({
  id: …,
  position: z.string().describe("The position or job title for this role."),
  period: z.string().describe("The period of time this role was held."),
  description: z.string().describe("The description of this specific role. This should be a HTML-formatted string."),
});

export const experienceItemSchema = baseItemSchema.extend({
  company: z.string().min(1)…,
  position: z.string().describe(
    "The position held at the company or organization. Used when there is only a single role. If multiple roles are provided in the 'roles' field, this serves as a summary title or can be left blank."),
  location: …,
  period: z.string().describe(
    "The overall period of time at the company. When multiple roles are used, this should reflect the total tenure."),
  website: …,
  description: …,
  roles: z.array(roleItemSchema).catch([]).describe(
    "List of individual roles held at this company to show career progression."),
});
```

And the project stays outside, with no employer link of any kind:

```ts
export const projectItemSchema = baseItemSchema.extend({
  name: z.string().min(1)…,
  period: z.string()…,
  website: …,
  description: …,
});
```

([AmruthPillai/Reactive-Resume, `packages/schema/src/resume/data.ts`](https://github.com/AmruthPillai/Reactive-Resume/blob/main/packages/schema/src/resume/data.ts))

**This is the strongest single piece of evidence in the document.** A shipping product, five months ago,
solved exactly the problem #150 poses — *this job contains several named things, each with its own dates
and its own body* — and the named thing it chose was the **role**, not the project. Note also what the
nesting cost it: the parent's `position` and `period` acquire conditional meanings (*"can be left blank"*,
*"should reflect the total tenure"*). That is the price of a sub-entry, paid by a real codebase.

### The peers, quoted

- **JSON Resume** (live monorepo `jsonresume/jsonresume.org`, `packages/schema/schema.json`): `work[]`
  holds `name`, `location`, `description`, `position`, `url`, `startDate`, `endDate`, `summary`
  (*"Give an overview of your responsibilities at the company"*), `highlights`. **No nested projects
  field.** `projects[]` is top-level, and its only employer link is `entity` — *"Specify the relevant
  company/entity affiliations e.g. 'greenpeace'"* — an **optional free string**.
  ([schema.json](https://raw.githubusercontent.com/jsonresume/jsonresume.org/master/packages/schema/schema.json))
- **LinkedIn**: projects are their own sub-resource — `POST https://api.linkedin.com/v2/people/id={person
  ID}/projects` — and the link to a job is the `occupation` field: *"Position a member held while working
  on this project. Selected from a position of the member's profile."* The live sample request body shows
  `"occupation": "urn:li:position:(urn:li:person:123ABC,677616236)"`.
  ⚠️ **A documentation inconsistency worth recording:** the field reference describes `occupation` as
  *"Represented as either a standardized referenced company or school URN"*, while the sub-resource
  sample sends a **position** URN. The sample is the more specific evidence and it is what #147 recorded.
  ([Project Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/project) ·
  [Profile Edit API — Projects](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-edit-api/projects))
- **yamlresume**: `WorkItemSchema` = `name`, `position`, `startDate`, `summary` required; `endDate`,
  `keywords`, `url` optional. **No projects field, no client field.** `projects` is a top-level section
  described as *"your personal and professional projects"* — it explicitly covers the work project, and
  its item (`name`, `startDate`, `summary` required; `description`, `endDate`, `keywords`, `url` optional)
  **has no employer or client slot at all**.
  ([`packages/core/src/schema/content/work.ts`](https://github.com/yamlresume/yamlresume/blob/main/packages/core/src/schema/content/work.ts) ·
  [`projects.ts`](https://github.com/yamlresume/yamlresume/blob/main/packages/core/src/schema/content/projects.ts))
- **rendercv**: `ExperienceEntry` = `company` + `position` + the base entry fields. No projects field, and
  no project entry type in the schema at all — a project is just an entry in a custom section.
  ([`src/rendercv/schema/models/cv/entries/experience.py`](https://github.com/rendercv/rendercv/blob/main/src/rendercv/schema/models/cv/entries/experience.py))
- **Europass**: the profile sections named on the official page are *Education and training · Work
  experience · Language skills · Digital skills · **Projects** · Achievements · Skills*. Projects sit
  outside the basic profile, as a top-level addition; **nothing on the page describes nesting a project
  inside a work experience entry.**
  ([Europass — How to complete my Europass profile](https://europass.europa.eu/en/how-complete-my-europass-profile))

### The standards, and one clean zero

**HR-XML 2.5** — read from the shipped XSDs, not from a summary. `PositionHistoryType` contains, in order:
`Title`, `OrgName`, `OrgInfo`, `OrgIndustry`, `OrgSize`, **`Description` (required, `xsd:string`)**,
`StartDate`, `EndDate`, `Compensation`, `Comments`, `Verification`, `JobLevelInfo`, `JobCategory`.
Everything a person did in a job is one required string. `StructuredXMLResumeType` holds `ContactInfo`,
`ExecutiveSummary`, `Objective`, `EmploymentHistory`, `EducationHistory`, `LicensesAndCertifications`,
`MilitaryHistory`, `PatentHistory`, `PublicationHistory`, `SpeakingEventsHistory`, `Qualifications`,
`Languages`, `Achievements`, `Associations`, `References`, `SecurityCredentials`, `ResumeAdditionalItems`,
`SupportingMaterials`, `ProfessionalAssociations`.

🚨 **A case-insensitive search for `project` across the whole of `Resume.xsd` returns zero matches.** The
standard has room for patents, publications and speaking events and none for projects. Note also that
HR-XML *does* nest — `EmploymentHistory → EmployerOrg → PositionHistory`, both unbounded — so the absence
is a choice, not a limitation: it nests **positions inside employers**, never anything inside a position.
([`EmploymentHistory.xsd`](https://github.com/setu-standards/xml-specifications/blob/main/hr-xml/CPO/EmploymentHistory.xsd) ·
[`Resume.xsd`](https://github.com/zeliboba/HR-XSL/blob/master/lib/hr-xml-2.5/HR-XML-2_5/StandAlone/Resume.xsd))

⚠️ **HR Open Standards 4.x — could not check, and this is not the same as finding nothing.** The public
GitHub org `HROpen` has **one** repository (`APISpecifications`, pushed 2026-02-12) and it contains only
`organizations`, `transport-objects` and `common` — **no candidate or resume schema**. The Candidate /
Trusted Career Profile schemas are behind the downloads page, which states *"you can register for a free
Community membership account"* before access. The only 4.x structural fact I could verify from public
material is the XPath `/Candidate/CandidateProfile/EmploymentHistory/EmployerHistory/PositionHistory/`,
which shows the same employer→position nesting HR-XML 2.5 has. **Whether HR Open 4.6 added a project
element is unknown.** ([HR Open — Standards](https://www.hropenstandards.org/standards) ·
[downloads](https://www.hropenstandards.org/standards-downloads) ·
[GitHub org](https://github.com/HROpen))

**Textkernel Tx v10** — the position object holds `Job Title`, `Organization`, `Location`, `City`,
`Region`, `Country Code/Description`, the Profession/ONET/ISCO code blocks, `Start Date`, `End Date`,
`Years`, `Months`, `Is Latest Experience`, `Is Current Experience`, **`Description`** and `Item Id`. **No
project, assignment, engagement or client sub-object**, and no top-level `Projects` member — confirming
#147's read of the SDK from the other side (the documented data model).
([candidate data model](https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/))

**HireAbility / ALEX** — ⚠️ **could not check.** Their product pages state ALEX outputs *HR-XML* and JSON,
but the schema itself is not publicly reachable. Its declared base standard has no project element (above),
which is suggestive and not evidence.
([HireAbility — ALEX Resume and Job Parser](https://www.hireability.com/products/alex-cv-resume-parser/))

**Affinda** — ⚠️ **could not check at source.** `docs.affinda.com/reference/getresume` returns 404 and the
docs pages reachable to automated fetch describe workflow configuration, not the resume field schema.
Secondary material claims project entries are extracted with titles and descriptions; **not verified, do
not cite it as established.**

### The applicant-facing ATS profiles

- **Greenhouse Harvest** — no projects object or endpoint on the candidate (established in #147; v1/v2
  deprecated after **2026-08-31**).
- **Lever** — the Opportunity object carries `id`, `name`, `headline`, `location`, `emails`, `phones`,
  `stage`, `archived`, `applications`, `feedback`, `interviews`, `notes`, `files`, `tags`. **There is no
  projects field, and no structured work history at all** — `headline` is *"typically a list of previous
  companies where the contact has worked or schools that the contact has attended"*, as text.
  ([Lever API documentation](https://hire.lever.co/developer/documentation))
- **SAP SuccessFactors** — the relevant find is `Background_SpecialAssign`, an OData background entity
  used *"to write project assignments to employees' background"*. **It is a peer of
  `Background_InsideWorkExperience` and `Background_OutsideWorkExperience`, not a field inside them.**
  ⚠️ The authoritative SAP Help page for the candidate-profile background list is JavaScript-rendered and
  did not yield content to automated fetch, so the **complete** element list is unverified; the
  `Background_SpecialAssign` entity and its purpose come from SAP's own support knowledge base.
  ([SAP KBA 2477558 — SFOdata.Background entities](https://userapps.support.sap.com/sap/support/knowledge/en/2477558))
- **Workday** — ⚠️ **could not check at source.** Workday Community documentation is behind a customer
  login. Every public description of the candidate application (university and employer career-site
  guides) lists the Experience section as **Work Experience · Education · Skills**, with work experience
  taking company, title, dates and free-text responsibilities/achievements. **No projects entry is
  described anywhere, but this is second-hand and should be recorded as such.**
- **Oracle Taleo / Recruiting Cloud** — ⚠️ **could not check.** Oracle's profile content-section list is
  spread across configuration guides that did not yield the predefined section names to automated fetch.
  Oracle documents that profiles are built from configurable *content sections* (Experience, Education,
  and so on), which means a project section is **configurable by a customer** rather than shipped or
  absent by default. Do not record Oracle as a checked negative.

---

## Q3 — Does naming it buy anything a plain bullet does not?

Three consumers can benefit: the tailored page, the machine matching, the person's own editing. Taken one
at a time, with evidence rather than opinion.

### Matching: no, and it is provable in our own code

[ADR-0006](../adr/0006-a-project-is-a-container-not-a-fact.md) clause 9 established that a project reaches
the **judged score** and never the eligibility gates. Following that through to what the grader actually
receives:

`apps/api/src/judge.ts:66-75` builds the model input as:

```
===CANDIDATE FACTS===
- id: <claim id>
  text: <one line, newlines collapsed>
```

**That is the whole evidence payload.** No employer. No job title. No dates. No `role`. **The judge cannot
see which job a sentence belongs to, let alone which project.** `card-judge.md`'s headline rule is
*"the candidate's own phrasing counts"* — it grades meaning against sentences, and grouping is not a
sentence.

**Consequence, stated plainly:** naming a project changes the matcher's input **only** if the name ends up
inside a bullet's text — which is exactly what a plain bullet already achieves (`Chatbot FINDER:
Coordinated development of a chatbot…`). A container adds a field the grader never reads.

### ATS keyword extraction and recruiter search: no, with one narrow exception

- **No ATS surveyed exposes a project as a search or filter field.** Greenhouse, Lever, Textkernel and
  Workday all lack the object to bind a filter to (above, and #147 §Q4).
- **The parsers that would feed such a filter mostly do not emit one.** Textkernel: no project object.
  Daxtra inside a position: a `[0..1]` string. RChilli: a name, skills, team size.
- **The one real exception is a skill feature, not a project feature.** RChilli's skill `Evidence` enum
  includes `ProjectSection` alongside `ExperienceSection`, `SkillSection` and others — a skill can record
  that a project is where it was demonstrated (#147). That is a mention-site, and #147 already established
  it is **one vendor** while Textkernel anchors skills to jobs and degrees only. It is prior art for
  *skills*, and it does not need a named container on our side to work.
- **Our own advert corpus asks for nothing here.** 16 of 17 postings use the word *project* — always about
  the role being advertised, never a request for the candidate's named projects. `portfolio`: 0 of 17.

### The person's own editing: plausibly yes, and it is unmeasured

A container gives the person something to reorder, retitle or drop as a unit rather than bullet by bullet.
That is a genuine benefit and it is the one nobody has evidence for: **no source read here measures it**,
and the corpus cannot show it. It is also the benefit ADR-0006 clause 2 already banked for the *personal*
project, where it was load-bearing because three loose paragraphs could not otherwise be grouped. **Here
it is not load-bearing**: the bullets already have a home — the job — and the grouping being added is a
second, finer one.

### The honest summary

**Say it as the ticket asked to have it said: for the tailored CV, the machine matching, and the parsers,
naming a work project buys nothing a bullet does not.** What it buys is a tidier page and a slightly
nicer editing unit. **That is a presentation choice, and it belongs to the design effort, not to this
map.**

---

## Q4 — What does it cost, priced against the repo's own rules?

### It is the employer case, and ADR-0001 says so in its own words

ADR-0001's *What this rule does NOT cover* section is exact: *"Promoting part of an existing fact into its
own kind is a migration, and this rule does not make it cheap."* A named project sub-entry is **precisely**
that — today the project is words inside a job bullet; making it a named container with a client and dates
promotes part of an existing thing into its own kind.

**It is free right now for one reason only, and that reason expires.** [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126)'s
job record does not exist yet, so there is no stored job to rewrite. ADR-0001's own conclusion applies
verbatim: *"Whether a part of a fact deserves to be its own kind must be decided when that fact is first
shaped."* **This ticket therefore belongs before #126 ships, not after** — which is the strongest argument
in the document for answering it now rather than deferring it, and it is an argument about *timing*, not
about building.

### Rule 4's four readers, priced honestly for the two candidate answers

**Answer A — leave them as bullets, add a naming convention.** The project's name goes into the bullet
text (which is already what our market's CVs do) and, optionally, into the existing free-string `role`
slot as `employer — title — project`.

| Reader | Cost |
|---|---|
| Stored, listed, corrected | **Zero new storage.** `CandidateClaim.role` is `z.string().min(1)` with no format constraint (`candidateClaims.ts:31`) |
| Used in matching | **Already met** — the sentence carries the name; the judge reads sentences |
| Prints on the tailored CV | **Zero** — it is a bullet, and `Draft.experience[].bullets` already exists |
| Contract validation | **Zero** — no shape change, so no zod port and no `.mjs` oracle change |

⚠️ One compatibility check done rather than assumed: `conservationIssues()` matches a claim to a role with
`c.role.toLowerCase().includes(key(recent.employer)) && …includes(key(recent.title))`
(`apps/api/src/preview.ts:211-215`) — **substring tests**, so appending a project name to `role` does not
break the recent-role bullet floor.

**Answer B — a named sub-entry with a client, dates and its own bullets.**

| Reader | Cost |
|---|---|
| Stored, listed, corrected | **New part on the job record**, which #126 has not shaped — plus a **client**, which is a second new part and arguably a second element (see Q5) |
| Used in matching | **Met, but pointlessly** — the judge cannot see grouping (Q3), so this reader is satisfied without the feature doing anything |
| Prints on the tailored CV | **Real work.** `Draft.experience[]` has no project or client slot, `bullets` is a flat `string[]` capped at 8, and the renderer emits one `<ul>` per role (`preview.ts:301-311`) |
| Contract validation | **Zod port and the `.mjs` oracle**, per the repo rule that the oracle is the spec |
| **ADR-0004 clause 1a** | **Every part needs an origin.** A project name read from a heading points at source words — but `source_quote` is capped at 200 chars and a roll-up line exceeds it. A **client** and a **date** each need their own origin too |
| **ADR-0006 clause 7** | `conservationIssues()` must learn to watch a **third** thing (it is already gaining a projects check), and it needs the negative test ADR-0004 clause 1 demands |

**And a cost ADR-0006 did not have to pay, which this one does:** ADR-0006 clause 4 declined an optional
date on the personal-project container because *"0 of 3 standalone entries carries one"*. **The same
evidence holds here and is stronger: 0 of 18 nested named projects carries a date either.** Building a
date field on a work project means building a field the entire corpus leaves empty — and the dates that
*do* exist belong to a **client engagement**, a different thing entirely.

### Against ADR-0001's growth-rule footnotes

- **Rule 5's sorting test does not apply** — ADR-0006's scope note is exactly on point: *"if the new thing
  would hold nothing but a name and the sentences hanging off it, it is a container"*. A work project is a
  container. Skip the test.
- **Rule 4's *multi-session* cost is per-element** — ADR-0006's other scope note. Priced here: Answer A is
  **hours**; Answer B is roughly **one session for the container plus a second for the client**, and the
  client is the part that has no shape anywhere in the repo.
- **ADR-0001 rule 4's new question from ADR-0008** — *how does it arrive?* A work project name arrives
  **read** (it is in the document) or **asked**. A client is the same. Neither is *worked out*, so the
  Mei rule does not bite. No new problem here.

---

## Q5 — Does the answer differ for a nameable client versus one that cannot be named?

**Yes, and it is the sharpest reason not to make a client a required part.**

### The corpus already contains both cases, and the unnameable one is our market

- **Nameable** — Thomas: `ASSYTEM (client)`, `TRACTEBEL (client)`, and a client inside a project title
  (`« Logement pour le client ICF La Sablière »`). Construction and nuclear engineering, where the
  client and the site are public.
- **Unnameable, and handled by never mentioning it** — **Remy IM** spent 2017–2019 as a *Microsoft
  Dynamics Consultant* at **Solutec**, a French consultancy. His bullets say *"Customized the Microsoft
  Dynamics CRM based on client needs"* and *"Provided crucial client support"*. **He names no client
  anywhere on the CV.**
- **Unnameable, and handled by folding the engagement into the job title** — **Kulpakorn Ngamvijit** at
  **Accenture**: `Business Analyst - Banking Mobile Application`. The engagement is described; the bank is
  not named. The same device at Bred IT.

**Three of our five in-market CVs come from consulting or client-service work, and none names a client.**
A named project entry that requires a client breaks for the majority of the corpus and for the market
[ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) says we serve (Hong Kong · Singapore ·
Vietnam · Australia — heavy banking and consulting).

### No shipped schema requires a client, and almost none has a slot for one

| System | Client / organisation on a project |
|---|---|
| **RChilli** (nested) | **None** — `ProjectName`, `UsedSkills`, `TeamSize`. The employer is the parent; the client has nowhere to go |
| **Daxtra** `Project` in a position | **None** — a single string |
| **Daxtra** `ProjectHistory` | Inherits `EmployerOrg` from `EmploymentHistoryType` — i.e. **a client is modelled as an employer**, with all the risk that implies |
| **LinkedIn** | **None.** `occupation` points at *the member's own position*, never at a customer |
| **JSON Resume** | `entity` — **optional free string**. *"Specify the relevant company/entity affiliations e.g. 'greenpeace'"*. Free text absorbs *"a Tier-1 investment bank"* without complaint |
| **yamlresume · Reactive-Resume · rendercv** | **None at all** |

**So: exactly one shipped project model has a client-shaped slot, it is optional, and it is free text.**
A design that makes a client mandatory has no precedent anywhere.

### The anonymised-client convention itself

The practice — *"a Fortune 500 electronics company"*, *"a leading global bank"*, *"a mid-market SaaS
company"* — is consistent across every source that addresses it, and **the sources that address it are
practitioner forums rather than institutions**: PrepLounge's consulting Q&A, Wall Street Oasis, Manager
Tools. They agree that anonymised descriptors are standard and expected in consulting recruitment, that
naming a client is acceptable only where the engagement is already public, and that an NDA's exact terms
govern. ⚠️ **These are not high-trust primary sources and this half does not lean on them** — the
`/last30days` companion is the right place to weigh practitioner consensus.

⚠️ **The one institutional page found — St Mary's University Career Center, *"How To Write a Resume If You
Have Had an NDA"* — carries no guidance of its own; it links out to `resumeworded.com`, an SEO careers
site.** Checked and rejected as a source.
([St Mary's](https://careercenter.stmarytx.edu/resources/how-to-write-a-resume-if-you-have-had-an-nda/))

**What this means for the design, independent of source quality:** an anonymised client is a **description**
(*"a Tier-1 investment bank"*), not an identity. It cannot be normalised, deduplicated, matched against an
employer entity, or corrected against a canonical list. A field that holds it is a free string that only
ever prints — which is [ADR-0007](../adr/0007-what-prints-is-decided-per-application.md)'s new ADR-0001
scope-note category (*a fact that exists only to be printed*), and which is another way of saying **it is
a sentence**. It already survives as one today, inside the bullet.

### 🚨 The hazard nobody has written down: a client is not a project, and it looks like a job

ADR-0006 clause 5 forbids a **project** reaching `roles[]` or `Draft.experience`, because a project title
printing as an employer is decision 9's *the machine never adds silently*. **The client case is the same
failure with a better disguise**, and no rule covers it:

```
BTM CONSULTANT, Lyon, France            10/2018 - 05/2021    ← the employer
  ASSYTEM (client) - 02/2021 - 05/2021                       ← a name and a date range
  TRACTEBEL (client) - 10/2018 -12/2020                      ← a name and a date range
```

A client block is an **organisation name plus a date range nested under an employer** — indistinguishable
in shape from an employment entry, unlike a project title which at least reads as a thing rather than a
company. If it lands in `roles[]`, the CV prints two employers Thomas never worked for.

**Today it is blocked by luck, not by design:** `MinedRole` requires `title: z.string().min(1)`
(`candidateClaims.ts:12`) and a client block has no title, so the contract rejects the row. That is a
contract accident, not a rule, and it will not survive #126 reshaping the job record.

**This is the one build item this research would actually defend**, and it is a guardrail rather than a
feature: whatever #126 decides, a `(client)` line must never become an employer, and the check must be
able to tell *found nothing* from *did not run*.

---

## What remains open

**1. HR Open Standards 4.6 — genuinely unchecked.** The public GitHub org carries no candidate schema and
the downloads require a free account. If a build ticket needs to know whether the Trusted Career Profile
models a project inside a position, **register and read it**; do not infer from HR-XML 2.5.

**2. Workday and Oracle candidate profiles — unchecked, for different reasons.** Workday's docs are behind
a customer login; Oracle's profile sections are customer-configurable, so "does it ship a project section"
may not have a single answer. Neither should be recorded as a checked negative.

**3. Affinda and HireAbility — unchecked.** Affinda's field reference 404s and its reachable docs describe
workflow configuration; HireAbility publishes no schema. Secondary sources say Affinda extracts projects;
unverified.

**4. RChilli's project object beyond three fields — still unresolved after two attempts.** #147 could not
read the helpdesk article (403) and neither could this pass. The schema page confirms three keys; whether
a paid parse returns more is unknown. **If it matters to a ticket, get a key and parse Thomas's CV — it
remains the ideal test document**, and it would settle the client and date questions in one call.

**5. Whether a named project sub-entry helps or hurts a real recruiter's reading.** No evidence either
way, from any source, at any quality level. The claim that it "looks more professional" is untested and
should not be written into a spec as though it were established.

**6. Whether the miner keeps a project heading as a claim.** Undefined today (see *What the pipeline
preserves and loses*). It is answerable in an afternoon by running the miner over Thomas's CV, and it is
the single cheapest experiment this research can recommend — because if the *name* already survives into
a claim, Answer A is finished work rather than a change.

## What this research cannot settle

**It cannot settle the design.** Both answers survive the evidence. Answer A (bullets, plus a naming
convention) is what our market's CVs already do, costs nothing against all four of rule 4's readers, and
loses only a grouping the matcher cannot see. Answer B (a named sub-entry) is shipped by exactly one
parser in a three-field form that would drop the client and the dates anyway, and its nearest live
precedent — Reactive-Resume — built the mechanism for **roles** instead.

**It cannot tell you the frequency in the wild.** One CV in six, and no published number exists — the same
void #147 documented for the standalone section. Any percentage that appears in a spec review should be
challenged for its sample.

**And it cannot make the client question go away by answering the project question.** Every route through
this decision runs into the same wall: **the client has no shape anywhere in this repo, no shipped schema
requires one, our own market cannot name one, and a `(client)` line looks exactly like a job.** Whatever
is decided about naming a project, that is the part that can print something false.

---

## Sources, with liveness

**Read directly at source — schemas and code**

- **Reactive-Resume** (40k★) — `roleItemSchema`, `experienceItemSchema`, `projectItemSchema`. `roles[]`
  added 2026-03-04 (*"feat(experience): add role progression…"* #2761); file last touched 2026-07-30.
  https://github.com/AmruthPillai/Reactive-Resume/blob/main/packages/schema/src/resume/data.ts
- **JSON Resume** — live monorepo schema; `work[]` has no projects field; `projects[]` is top-level with
  optional `entity`. Liveness established in #147 (npm `@jsonresume/schema` v1.3.1, 2026-07-22).
  https://raw.githubusercontent.com/jsonresume/jsonresume.org/master/packages/schema/schema.json
- **yamlresume** — `WorkItemSchema`, `ProjectItemSchema`.
  https://github.com/yamlresume/yamlresume/blob/main/packages/core/src/schema/content/work.ts ·
  https://github.com/yamlresume/yamlresume/blob/main/packages/core/src/schema/content/projects.ts
- **rendercv** — `ExperienceEntry`.
  https://github.com/rendercv/rendercv/blob/main/src/rendercv/schema/models/cv/entries/experience.py
- **HR-XML 2.5** — `PositionHistoryType`, `StructuredXMLResumeType`; **zero occurrences of "project"**.
  https://github.com/setu-standards/xml-specifications/blob/main/hr-xml/CPO/EmploymentHistory.xsd ·
  https://github.com/zeliboba/HR-XSL/blob/master/lib/hr-xml-2.5/HR-XML-2_5/StandAlone/Resume.xsd
- **Daxtra Candidate Profile Schema 2.0.40** — `ProjectHistory` (root, `EmploymentHistoryType`);
  `Project` `[0..1]` `daxtraStringWithIDs` inside `DaxPositionHistoryUserAreaType`. Both added in 2.0.31
  (2015-10-06). https://cvxdemo.daxtra.com/cvx/cvx_schema/candidate/index.html
- **RChilli v8** — `Projects` nested in `SegregatedExperience`; three keys.
  https://docs.rchilli.com/kc/resume%20parser%20schema/c_Resume_parser_schema_Segregated_Experience.html ·
  https://docs.rchilli.com/kc/c_RChilli_resume_parser_fields
- **Textkernel Tx v10** — position field list, no project object.
  https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
- **LinkedIn** — Project fields and the Projects sub-resource, with the `occupation` position-URN sample.
  ⚠️ `ms.date: 2020-09-01` / `updated_at: 2021-10-11` and `2021-05-31` / `2022-04-06`; API is
  partner-restricted. Field reference and sample body disagree on `occupation`'s URN type.
  https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/project ·
  https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-edit-api/projects
- **Lever** — Opportunity object; no projects field, no structured work history.
  https://hire.lever.co/developer/documentation
- **This repo** — `apps/api/src/judge.ts:66-75` (the grader's flat evidence payload),
  `apps/api/src/preview.ts:105-139` (Draft), `:187-230` (`conservationIssues`),
  `packages/contracts/src/candidateClaims.ts:10-38` (`MinedRole`, `CandidateClaim`),
  `apps/api/prompts/claim-miner.md` rules 1/6/8, `apps/api/prompts/preview-tailor.md`,
  `apps/api/prompts/card-judge.md`, `apps/api/data/sample-postings.json` (17 adverts),
  `data/cvs/*.pdf` (six CVs, all re-read).

**Institutional guidance — primary, but convention rather than evidence**

- **Purdue OWL — Work Experience Section.** Company + location + title + dates + a bulleted duty list; no
  sub-headings.
  https://owl.purdue.edu/owl/job_search_writing/resumes_and_vitas/resume_sections/work_experience_section.html
- **CMU SCS Graduate Resume Guide (2023).** Projects as a separate section; the nested option offered
  explicitly for publications and conferences and **not** for projects.
  https://www.cmu.edu/career/documents/sample-resumes-cover-letters/scs_graduate_resume_guide_2023.pdf
- **APM — 10 tips for writing a winning project management CV.** Budget, team, methodology, project type
  and length; never a project name, client or project dates.
  https://www.apm.org.uk/jobs-and-careers/tips-for-writing-a-winning-cv/
- **Europass — How to complete my Europass profile.** `Projects` as a top-level profile section.
  https://europass.europa.eu/en/how-complete-my-europass-profile
- **Berkeley Career Engagement** and **MIT CAPD** — established in #147, cited here without re-derivation.

**Behind a wall or otherwise unreadable — recorded as unchecked, not as negative**

- **HR Open Standards 4.x candidate/resume schema** — free registration required; public GitHub org has
  no candidate schema. https://www.hropenstandards.org/standards-downloads · https://github.com/HROpen
- **RChilli helpdesk, "How does RChilli parse the project details in a resume?"** — **HTTP 403** to
  automated fetch, twice now (#147 and this pass). Quotes above are from search indexing of that page.
  https://help.rchilli.com/hc/en-us/articles/900005421063-How-does-RChilli-parse-the-project-details-in-a-resume
- **SAP SuccessFactors candidate-profile background element list** — JS-rendered; only
  `Background_SpecialAssign`'s existence and purpose verified, via
  https://userapps.support.sap.com/sap/support/knowledge/en/2477558
- **Workday candidate profile** — customer login. **Oracle Recruiting Cloud content sections** — not
  reachable; sections are customer-configurable. **Affinda field reference** — 404.
  **HireAbility ALEX schema** — not published.

**Checked and rejected as sources**

- St Mary's University Career Center NDA resume page — defers entirely to `resumeworded.com`.
- PrepLounge, Wall Street Oasis, Manager Tools, Team Blind — practitioner forums, consistent but not
  primary; the `/last30days` companion owns this register.
- zety, novoresume, beamjobs, themuse, jobseeker and similar — the "Relevant Projects subheading" advice
  traces entirely to this layer, which #147 already characterised.

**Prior research this builds on (do not re-derive)**

- [`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) — the corpus count this document
  **corrects on one row** (Adrien is not a second nested case), JSON Resume's liveness, RChilli's
  `Evidence: ProjectSection`, Textkernel's `FoundIn` anchors, the absence of any published frequency.
- [`projects-umbrella-section-naming.md`](projects-umbrella-section-naming.md) — a link is contact detail,
  not a project; the five shipping tools read at source level.
- [`cv-elements-existing-data-standards.md`](cv-elements-existing-data-standards.md) ·
  [`skill-shape-granularity-normalisation-levels.md`](skill-shape-granularity-normalisation-levels.md) ·
  [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md).
