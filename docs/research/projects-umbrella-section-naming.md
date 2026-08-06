# One section or several? Projects, portfolios, GitHub, websites and open source

_Research for wayfinder map #127 / ticket
[#148](https://github.com/adrien-mounier/jobcrush-app/issues/148) — **deep-source half**.
Written 2026-08-06. The `/last30days` companion is a separate file._

_Why this exists: #146 is about to shape a project entry, and #148 asks the prior question — whether
a personal project, a portfolio, a GitHub profile, a personal website, a side project and
open-source work are **one element or several**, and what the one is called. ADR-0001 rule 1 makes
that the shape, not a label. Owner decision 8 makes the name something a human will hear read
aloud._

**Everything below was read from the schema file, spec, or official guidance page itself, not from a
write-up about it.** Field names and section names are quoted exactly as the source writes them.
Where a page blocked automated fetching, that is flagged inline and listed in the appendix.

---

## Bottom line

1. **They are two kinds, and the evidence is close to unanimous.** The hypothesis in Q2 survives its
   hardest test. A **project is a top-level record** with a name, dates and a description. A
   **link is a property of the person**, and every system that models it puts it in the *contact /
   identity block* — never in a section. JSON Resume expresses both in one file: `projects` is a
   top-level array; `profiles` sits **inside `basics`**, next to `email` and `phone`.
2. **The doing-kind has a converged name, and it is the boring one: `Projects`.** HR Open's
   enumerated section list, LinkedIn's profile sections, and MIT's optional categories all use
   exactly that word. No source anywhere used `Selected Projects`, `Side Projects`, `Online
   Presence`, or `Links` as a canonical name.
3. **The link-kind has no section name anywhere, because nobody makes it a section.** Four
   independent systems name their link container four different ways internally (`profiles`,
   `personalUrls`, `website_addresses`, "Contact info → Websites") and **none of them surfaces that
   name to the user.** Asking "what is the links section called" has an answer: *there isn't one*.
4. **"Portfolio" is not a section name in any system we found — it is a URL *type*.** Greenhouse's
   candidate object and LinkedIn's website dropdown both carry a near-identical enum in which
   `portfolio` is one kind of link alongside `personal`, `company` and `blog`. Two independent
   industry systems reached the same answer.
5. **The single most common home for a project is not a section at all — it is inside a job.** Two
   of our six local CVs, Harvard's sample resume, JobsDB Hong Kong's engineer sample, and LinkedIn's
   own project form (which has a field binding a project to a role) all attach projects to a
   work-experience entry. **This is a third option the ticket did not list, and for our market it
   looks like the dominant one.**
6. **The umbrella does not survive outside software, and it does not survive in our market either.**
   Harvard, UPenn (academic) and AIGA (design) name no Projects section at all. For a designer the
   portfolio is a *link plus a separate artefact*; for an academic the equivalent is *Publications*.
   **A single name is the wrong shape if it is meant to cover everyone** (§5).
7. **The worst possible name for our market is `Portfolio`.** In IT project management "portfolio"
   is a formal PMI term meaning a collection of projects and programmes; in banking it means a
   holding of investments or clients. Read aloud to an IT-PM in a Hong Kong bank, *"today let's do
   your portfolio"* means something else entirely.
8. **#146 was right to defer awards, publications, volunteering and patents.** Every source that
   enumerates sections makes them **siblings** of Projects, never children (§7). One inconsistency
   exists, in JSON Resume, and it is worth knowing about.
9. **Nothing in any standard models open-source work.** Not JSON Resume, not HR Open, not LinkedIn,
   not Textkernel, not any ATS. It is always folded into Projects or into Work Experience, and the
   only guidance on which is secondary (§4).

---

## 0. The local corpus check — six real CVs, read for this ticket

The ticket required this first, and it changed the answer. All six PDFs in `data/cvs/` were read
natively.

| CV | Role / market | Projects-style section? | Any link? | Where projects actually appear |
|---|---|---|---|---|
| **Adrien Mounier** | Senior PM, banking IT, Bangkok | ✅ `PERSONAL PROJECTS` — 3 entries, bold title + prose paragraph, no dates, no organisation, no links | ❌ none. Header = email + mobile only | **Both**: the section, *and* a `Project Achievements` sub-block inside each of the 3 jobs |
| **Thomas Chauviere** | Draughtsman / project lead, construction, FR-CH | ❌ none | ❌ none | **Inside jobs only.** Each employer entry opens with an italic `Projets:` line naming 3–5 projects; one employer nests full project sub-entries with their own client, dates and bullets (`ASSYTEM (client) — 02/2021-05/2021 / Projet: Fessenheim …`) |
| **Pierre Mounier** | Customer success, Lisbon | ❌ none | ❌ none. "LinkedIn" appears only as a *tool* inside a skill line | — |
| **Giuliana Delre** | Purchasing manager, food industry, Bangkok | ❌ none | ❌ none | Only as a passing noun in an achievement bullet ("mold-development project"). Also carries a `Thesis` bullet inside the education entry |
| **Kulpakorn Ngamvijit** | Senior BA, banking, Bangkok | ❌ none | ❌ none | — |
| **Remy IM** | IT system analyst, banking, Paris/Singapore | ❌ none | ✅ **one** — a LinkedIn URL **in the header line, between the email and the city** | — |

**What the count says:**

- **Links: 1 of 6.** Zero GitHub, zero portfolio, zero personal website. The single link in the whole
  corpus is a LinkedIn URL sitting **in the header beside the email address** — exactly where the Q2
  hypothesis predicted it would be. Not one CV has a section called Links, Portfolio, Online
  Presence, or anything similar.
- **A projects-style section: 1 of 6** (the owner's own).
- **Projects nested inside a work-experience entry: 2 of 6** — i.e. **twice as common as the
  section.** In Thomas Chauviere's CV the nested project is a fully structured child record with a
  client, a date range and its own bullets, which is a richer object than the owner's section
  entries (which have no dates and no organisation at all).
- **Two of the six are in our stated market** (IT/banking, HK/SG-adjacent: Kulpakorn, Remy) and
  **neither has a projects section.**

**The honest caveat:** six CVs is not a corpus. What it is good for is falsifying claims, and it
falsifies one — *"a project lives in a Projects section"* is not what these CVs do. What it cannot
tell us is a rate.

**One local claim I could not re-verify:** the ticket states no advert in the 17-advert corpus
mentions any of the six terms. There are no advert files in the repo (`data/` contains only `cvs/`
and `uploads/`), so that count is carried forward from the ticket unverified.

---

## 1. Q2 — do the six split into two kinds? (the hypothesis, tested hardest)

**Verdict: yes, and it is the clearest finding in this document.** Every system that models both
models them in structurally different places. Not one system treats a GitHub URL and a side project
as the same kind of thing.

| System | The *pointer* kind — where it lives | The *thing you did* kind — where it lives |
|---|---|---|
| **JSON Resume** | `basics.profiles[]` — **nested inside the contact block**, alongside `email`, `phone`, `location`. Plus `basics.url` for the personal website. Schema description: _"Specify any number of social networks that you participate in"_; item properties `network` (_"e.g. Facebook or Twitter"_), `username`, `url` | `projects[]` — **a top-level section** of the document. Description: _"Specify career projects"_ |
| **Textkernel (CV/Resume Parser data model)** | `$.personal.personalUrls[].url` + `.type` — inside **Contact Details**. Type enum: `linkedin`, `twitter`, `viadeo`, `xing`, `facebook`, `google_plus`, `github`, `dribbble`, `soundcloud`, `wordpress`, `csdn`. Described as _"The URL to the social media profile or personal website mentioned in the document, including the type"_ | **Does not exist.** There is no projects field in the model |
| **Textkernel Tx Platform** (the Sovren lineage) | A "Reserved Data" section: _"The Parser uses this section to output all of the URLs, Email Addresses, Phone Numbers, and Twitter handles found anywhere in the document"_; plus `InternetWebAddress` as a contact method | **Does not exist.** `PROJECTS` is not among the 26 recognised `sectionType` values |
| **Greenhouse** (candidate object) | `website_addresses[]` = `{value, type}`, type enum **`"personal"`, `"company"`, `"portfolio"`, `"blog"`, `"other"`**; plus `social_media_addresses[]` = `{value}` | **Does not exist.** No projects field on the candidate |
| **LinkedIn** | **Contact info → Websites.** _"You can display up to three website links to your profile."_ Each has a "Website type" dropdown. Separately, **Featured** — _"Links to external websites, for example your personal blog or portfolio"_ | **Projects** — a named profile section, in the "Recommended" group |
| **HR Open 4.6** | Not in the profile model at all. The nearest thing is `attachments` — _"Attachments or online references related to the person's profile"_ | `Projects` — an enum value in `SectionTypeCodeList` |
| **AIGA** (design profession) | _"Include relevant details like email, phone, city/state, and LinkedIn/portfolio URLs"_ — in **Contact Information** | No projects section recommended |
| **Harvard OCS** | Contact block; and — unusually — URLs appear as *evidence inside a skill line*: `Web Design: Designed www.abc.com, www.xyz.com` under **Technical Skills** | No projects section; `Project:` is a **line inside** a Research Experience entry |

**The sharpest single piece of evidence** is JSON Resume, because both kinds live in one file and the
author had to choose: the link went **inside `basics`**, the project went **top-level**. The second
sharpest is that **Greenhouse and LinkedIn independently arrived at nearly the same URL-type enum**,
in which `portfolio` is a *kind of link*, not a section.

**What contradicts the hypothesis — the one real complication.** The two kinds are not symmetrical.
The pointer kind is real and universally modelled; **the "thing you did" kind is the one that is
frequently missing.** Textkernel models the link and not the project. Greenhouse models the link and
not the project. So the split is not "two sections" — it is closer to **"a contact-block property
(universal) and a section (optional, and often absent)."**

**And a third placement the ticket did not list.** Projects attached to a job. LinkedIn's own
Projects form includes a field binding the project to one of your listed roles; Harvard's sample
puts `Project:` inside a Research Experience entry; JobsDB Hong Kong tells engineers to _"give
details of major projects you have worked on and your responsibilities in each role"_ **within Work
Experience**; and it is what 2 of our 6 local CVs do. _(The LinkedIn per-field detail is from
secondary write-ups — LinkedIn's own help page names the section but does not enumerate its fields.
Treat the field list as indicative, the section name as primary.)_

Sources:
[JSON Resume schema.json](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json) ·
[Textkernel candidate data model](https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/) ·
[Textkernel Tx parser output](https://developer.textkernel.com/tx-platform/v9/resume-parser/overview/parser-output/) ·
[Greenhouse candidate object](https://raw.githubusercontent.com/grnhse/greenhouse-api-docs/master/source/includes/harvest/_candidates.md) ·
[LinkedIn — add sections](https://www.linkedin.com/help/linkedin/answer/a540837/add-sections-to-your-profile) ·
[LinkedIn — Featured](https://www.linkedin.com/help/linkedin/answer/a550399/manage-featured-samples-of-your-work-on-your-linkedin-profile) ·
[LinkedIn — add a website](https://www.linkedin.com/help/linkedin/answer/a548010) ·
[HR Open PersonProfileInclusion](https://www.hropentech.org/4.6/common/json-2020-12/profile/PersonProfileInclusion.json) ·
[AIGA resume guidance](https://baltimore.aiga.org/resume-writing-guidance-for-designers/) ·
[Harvard OCS resumes guide](https://static1.squarespace.com/static/592b51c18419c2e1dd15123b/t/636e9bd189d2e53f6a7b693f/1668193233792/undergrad_resumes_and_cover_letters.pdf)

---

## 2. Q1 — is there a converged name?

**For the doing-kind: yes, weakly but really — `Projects`.** For the pointer-kind: **no name exists,
and that is the finding, not a gap in the research.**

| Candidate name | Who actually uses it | Verdict |
|---|---|---|
| **`Projects`** | HR Open `SectionTypeCodeList` (an enumerated value); LinkedIn (a "Recommended" profile section); MIT CAPD (an "Optional Category"); JSON Resume (`projects`, top-level) | **The only name with independent multi-source support.** Three of these are shipped systems, not advice articles |
| **`Personal Projects`** | The owner's own CV. Europass's prose (_"personal or professional projects"_). Not a named section in any schema | Common in the wild; **not standardised** |
| **`Selected Projects`** | Found in **no** schema, no ATS, no career-service guide read for this document | No evidence |
| **`Side Projects`** | Found in **no** schema, no ATS, no career-service guide read for this document | No evidence |
| **`Portfolio`** | Not a section anywhere. It **is** a URL type in Greenhouse (`"portfolio"`) and in LinkedIn's website dropdown | **A link type, not a section.** See §6 for why it is actively dangerous in our market |
| **`Open Source`** | Found in **no** schema and **no** standard, at all | No evidence (§4) |
| **`Links`** | No system exposes this name to a user | No evidence |
| **`Online Presence`** | No system exposes this name to a user | No evidence |

**Two negatives that carry as much weight as the positives:**

- **Textkernel — the largest CV-parsing vendor, and the Sovren lineage merged into it — recognises
  26 section types and `PROJECTS` is not one of them.** The list it *does* recognise is: `ARTICLES,
  AVAILABILITY, BOOKS, CERTIFICATIONS, CONFERENCE_PAPERS, CONTACT_INFO, EDUCATION, HOBBIES,
  IGNORE_DATA_AFTER, LANGUAGES, LICENSES, MILITARY, OBJECTIVE, OTHER_PUBLICATIONS, PATENTS,
  PERSONAL_INTERESTS_AND_ACCOMPLISHMENTS, PROFESSIONAL_AFFILIATIONS, QUALIFICATIONS_SUMMARY,
  REFERENCES, SECURITY_CLEARANCES, SKILLS, SPEAKING, SUMMARY, TRAINING, WORK_HISTORY, WORK_STATUS`.
  A vendor that bothered to recognise `CONFERENCE_PAPERS` and `SECURITY_CLEARANCES` and **not**
  `PROJECTS` is telling us something about what it sees in its corpus. _(That is an inference from
  the list, not a published statistic — labelled as such.)_
- **Harvard's career service names six optional resume categories and Projects is not among them.**
  Its optional categories are `Leadership Experience`, `Public Service Experience`, `Technical
  Skills`, `Research Experience`, `Performing Arts Experience`, `Activities`. Its advice is instead
  to name the experience section for what it actually is.

**So: is this settled?** Partially. `Projects` is the only defensible single word, but it is
**convention by convergence, not by standardisation** — no body has specified it, two of the most
industrially significant systems (Textkernel, Greenhouse) do not have the concept at all, and the
most prestigious career-service guidance omits it. Anyone who tells you "everyone calls it Projects"
has not looked at a parser.

---

## 3. Q3 — what the standards and parsers actually model, and how alive each is

| System | Models a **project**? | Models a **link**? | Liveness (checked 2026-08-06) |
|---|---|---|---|
| **JSON Resume** | ✅ `projects[]`, top-level | ✅ `basics.profiles[]` + `basics.url` | **Live, but the ticket's framing needs correcting** — see below |
| **HR Open Standards 4.6** | ⚠️ Only as an **enum value** — `Projects` in `SectionTypeCodeList`, consumed by the generic `OtherSectionType`. **There is no `ProjectType` schema.** `PersonProfileInclusion` has no projects property | ❌ Nothing. Nearest is `attachments` — _"Attachments or online references related to the person's profile"_ | **Live.** All 4.6 schema files fetched successfully today from `hropentech.org`. ⚠️ But the codelist's own description string is unfinished editorial: _"Values that describe other sections on a Trusted Career Profile. NARRATIVES vs OBJECTIVES, SUMMARY? OTHER SECTIONS COVERED IN EXISTING LER-RS - Skills and Abilities, Education, Employment, Licenses"_ — a question mark left in a shipped spec. Treat as work-in-progress |
| **Europass** | ❌ No built-in Projects section. Profile core is _"Education and training, Work experience, Language skills, Digital skills"_; projects arrive only via **user-created custom sections**: _"you can add new sections with a title you choose to describe your skills, achievements and projects"_ | ❌ No links section. Media can be attached _"in relevant sections"_ | **Live** (EU consumer product) |
| **LinkedIn** | ✅ **Projects**, in the "Recommended" group | ✅ Two places: **Contact info → Websites** (max 3, typed) and **Featured** (_"Links to external websites, for example your personal blog or portfolio"_) | **Live product**; the profile *API* remains partner-gated (per the earlier survey in `cv-elements-existing-data-standards.md`) |
| **Textkernel** (CV/Resume Parser) | ❌ **No projects field** | ✅ `personal.personalUrls[]` with a typed enum including `github` | **Live**, actively documented |
| **Textkernel Tx Platform** (Sovren lineage) | ❌ **No `PROJECTS` section type** | ✅ "Reserved Data" catches all URLs found anywhere in the document | **Live**, v9 and v10 both documented |
| **Greenhouse** | ❌ **No projects field** on the candidate object | ✅ `website_addresses[]` with type enum `personal / company / portfolio / blog / other`, plus `social_media_addresses[]` | **Live** |
| **schema.org** | ❌ No CV-project concept for a person | Generic `url` / `sameAs` on `Person` | Live, but candidate-side adoption is negligible (per the earlier survey) |

### Liveness correction on JSON Resume — the ticket's prior finding is misleading

#145 is cited in #148 as having found JSON Resume _"fully archived, 27 of 32 org repos dead"_. What I
observed today:

- `jsonresume/resume-schema` **is** archived: banner reads _"This repository was archived by the
  owner on Jun 12, 2026. It is now read-only."_ — 2.4k stars, 293 forks, 3 open issues. _(I did not
  reproduce the 4,719-star figure; on `resume-schema` itself the count is 2.4k.)_
- **But the archive is a relocation, not an abandonment.** Both `resume-schema` and `resume-cli` are
  retitled `MOVED to jsonresume/jsonresume.org`, and the README states: _"The JSON Resume schema
  specification and all ongoing development now live in the JSON Resume monorepo at
  jsonresume/jsonresume.org, under `packages/schema`. The npm package `@jsonresume/schema` remains
  unchanged."_
- **The monorepo is not archived and is active**: 1,514 commits, 51 open issues, 3 open pull
  requests, 288 stars, 66 forks.

**So: JSON Resume is small and volunteer-run, but it is not dead**, and "archived" here means "moved".
That matters because JSON Resume is the *only* schema surveyed that models both kinds cleanly — if we
were going to cite one shape as prior art for the split, this is it, and it would have been wrongly
discarded on a liveness read.

Sources:
[resume-schema (archived)](https://github.com/jsonresume/resume-schema) ·
[jsonresume.org monorepo (live)](https://github.com/jsonresume/jsonresume.org) ·
[HR Open SectionTypeCodeList](https://www.hropentech.org/4.6/recruiting/json-2020-12/codelist/SectionTypeCodeList.json) ·
[HR Open OtherSectionType](https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/OtherSectionType.json) ·
[Europass — complete your profile](https://europass.europa.eu/en/how-complete-my-europass-profile) ·
[Europass FAQ](https://europass.europa.eu/en/faq?page=2)

---

## 4. Q4 — where does open-source work go?

**No standard models it. At all.** Not JSON Resume, not HR Open's section codelist, not LinkedIn's
section list, not Textkernel, not Greenhouse, not Europass. The phrase does not appear as a field,
an enum value, a section type or a recognised heading in **any** primary source read for this
document.

That is a genuine finding, not a gap in the search: HR Open's codelist bothers to enumerate
`Military Service` and `Security Credentials`; LinkedIn bothers to ship `Test scores` and `Causes`.
Neither has open source.

**What guidance exists is secondary and splits three ways**, and I am labelling it weak because it
comes from resume-vendor blogs rather than schemas or career services:

1. A dedicated section (`Open Source Contributions` / `Open Source Projects`) when volume justifies
   it — the rule of thumb offered is roughly three or more entries;
2. Folded into `Projects`, distinguished by naming the upstream org (Apache, CNCF, Mozilla) and the
   scale of the project;
3. Into `Work Experience` when it was substantial and role-shaped.

**Why this matters for the shape, and it cuts against a single umbrella.** The ticket predicted this
case would break the umbrella, and structurally it does: an open-source contribution has an
**organisation** (the upstream project), often **dates**, and often a **role** (maintainer,
contributor, reviewer). That is the shape of a work entry, not of the owner's own `PERSONAL PROJECTS`
entries — which carry no dates, no organisation and no role at all. **If one element has to hold
both, it is holding two different shapes.**

Note that JSON Resume anticipated exactly this and solved it *inside* the project object: `projects[]`
carries `roles` (_"Specify your role on this project or in company — e.g. Team Lead, Speaker,
Writer"_) and `entity` (_"Specify the relevant company/entity affiliations e.g. 'greenpeace',
'corporationXYZ'"_). That is the one design in the survey that makes an open-source contribution
expressible without a second element.

Sources: [VisualCV](https://www.visualcv.com/open-source-contributions-on-resume/) ·
[Enhancv](https://enhancv.com/blog/open-source-on-resume/) — **both secondary; no primary source on
this question was found.**

---

## 5. Q5 — does the umbrella survive outside software?

**No. The answer differs per profession, and in our own market it is the weakest.**

| Profession | Who says so | What the equivalent actually is |
|---|---|---|
| **Software / engineering student** | **MIT CAPD** career toolkit | **`Projects`** — listed under "Optional Categories" alongside `Awards & Honors`, `Activities/Involvement`, `Professional Organizations`, `Interests`, `Publications & Presentations`, `Skills`. Guidance: _"In addition to jobs, internships, UROPs or leadership roles, consider including class projects, competitions or even personal projects"_ |
| **Elite generalist undergraduate** | **Harvard OCS** | **No Projects section exists.** Optional categories are `Leadership Experience`, `Public Service Experience`, `Technical Skills`, `Research Experience`, `Performing Arts Experience`, `Activities`. A project appears as a **line inside an entry**: `Project: Microfabrication of Thin-film Heaters to Simulate Hotspots.` The advice is to name the section after the *kind of experience* |
| **Designer** | **AIGA** (the professional association for design) | **Neither a Projects nor a Portfolio section.** Sections are `Contact Information`, `Summary`, `Experience`, `Skills`, `Achievements`, `Education`, `References`. The portfolio is **a URL in Contact Information** — _"Include relevant details like email, phone, city/state, and LinkedIn/portfolio URLs"_ — **plus a separate artefact entirely.** Harvard says the same: _"Students in creative and performing arts can develop resumes, portfolios, and websites to support their specific job search"_ — three documents, not three sections |
| **Academic** | **UPenn Career Services** | **`Publications and presentations`**, and `Grants` only _"if you have received significant funding"_. **No Projects section.** Standard categories are _"name and contact information, education, honors and awards, experience—or, more specifically, 'research experience' and 'teaching experience'—publications and presentations, scholarly/professional affiliations, research interests, and teaching competencies"_ |
| **IT project management / banking — our market** | **JobsDB Hong Kong**, engineer CV sample | **No projects section.** Sections are `Summary`, `Work Experience`, `Key Skills`, `Software Skills`, `Education`, and the instruction is to _"give details of major projects you have worked on and your responsibilities in each role"_ — **inside Work Experience** |
| **Marketer** | No primary source found | **No evidence.** Stated plainly rather than guessed |

**The finding the ticket asked for:** *"if the answer is different per profession, a single name may
be the wrong shape."* **It is different per profession, and the difference is not cosmetic** — it is
a difference in *where the thing lives*. For a designer the answer is a link in the header; for an
academic it is a different section entirely; for an IT-PM in Hong Kong it is a child of a job. Only
for a software engineer is it a top-level section called Projects.

**And note the direction of the bias.** The umbrella is strongest exactly where our market is
weakest. Our market is IT project management and banking in HK/SG — the one profile in the table
whose primary guidance puts projects **inside work experience**, and which matches what 2 of our 6
local CVs actually do.

Sources:
[MIT CAPD career toolkit (PDF)](https://cdn.uconnectlabs.com/wp-content/uploads/sites/123/2025/01/MIT-CAPDs-Career-Toolkit-Crafting-an-effective-resume.pdf) ·
[MIT CAPD resumes](https://capd.mit.edu/resources/resumes/) ·
[Harvard OCS Resumes & Cover Letters (PDF)](https://static1.squarespace.com/static/592b51c18419c2e1dd15123b/t/636e9bd189d2e53f6a7b693f/1668193233792/undergrad_resumes_and_cover_letters.pdf) ·
[AIGA Baltimore](https://baltimore.aiga.org/resume-writing-guidance-for-designers/) ·
[UPenn CVs for faculty job applications](https://careerservices.upenn.edu/application-materials-for-the-faculty-job-search/cvs-for-faculty-job-applications/) ·
[JobsDB HK engineer CV sample](https://hk.jobsdb.com/career-advice/article/resume-cv-sample-engineer-position)

---

## 6. Q6 — what name a non-technical person actually understands

**Direct evidence: there is none.** I found **no published usability or comprehension study on CV
section names**. Not from Nielsen Norman Group, not from any ATS vendor, not from any career service.
If someone claims a name "tests better", they have not published it. **This is a plain "no evidence"
answer, as the ticket asked for.**

What exists is **three kinds of indirect evidence**, in descending strength:

**1. Revealed preference at scale (strongest).** LinkedIn ships a section literally called
**`Projects`** to roughly a billion mostly non-technical users, in the "Recommended" tier. Europass
ships to EU jobseekers of every profession and uses the word *projects* in its prose. HR Open, whose
members are HR software vendors, enumerated the same word. Three organisations with strong incentives
to be understood picked the same plain noun. This is not a study, but it is not nothing.

**2. General plain-language research (moderate, and genuinely applicable).** NN/g's navigation-label
research finds that _"Findability is maximized by old, well-known words instead of new, made-up
words"_, that _"Generic terms have low information scent: users aren't sure exactly what the link
will lead to, so they are reluctant to click on it"_, and that _"Jargon and branded terms that aren't
universally understood should be used only within the content pages, where users have context clues
to help them understand what the unfamiliar terms mean."_ Applied here, this argues **for** `Projects`
(old, well-known) and **against** `Online Presence` or `Selected Work` (invented category language).
It also flags a real risk in `Projects` itself: it is *generic*, and a generic label carries low
information scent — the person may not know what belongs in it until shown an example.

**3. 🚨 A terminology collision specific to our market (and this one is decisive against one name).**
`Portfolio` is not a neutral word for an IT project manager in a Hong Kong or Singapore bank:

- **In project management it is a defined technical term.** PMI's standard for portfolio management
  defines a portfolio as _"a collection of projects, programs and other work that is grouped together
  to facilitate the effective management of that work to meet strategic business objectives."_ An
  IT-PM hears "portfolio" and thinks of the programme-level view of their delivery estate. _(⚠️
  pmi.org refused automated fetch — 403. This quotation comes from search results summarising PMI's
  own page and should be verified against the PMI standard directly before being relied on in a
  product decision.)_
- **In banking it is a second technical term** — a holding of investments, loans or clients;
  "portfolio manager" is a job title.

So the sentence *"today let's do your portfolio"* is, for our exact target user, **ambiguous between
three meanings, two of which are their day job.** That is a stronger reason to reject the name than
any preference argument.

**Applying the read-aloud test from owner decision 8:**

| Sentence | Assessment |
|---|---|
| _"today let's do your **projects**"_ | Works. Plain, old word; used by LinkedIn, HR Open, MIT. Weakness: generic — needs an example to disambiguate ("things you built or ran outside your job description") |
| _"today let's do your **personal projects**"_ | Works, and is *more* specific than `Projects`. But it excludes open-source work done with others and excludes projects done at work — which is where 2 of our 6 CVs actually put them |
| _"today let's do your **portfolio**"_ | **Reject for our market.** Collides with PMI's term and with banking's term |
| _"today let's do your **side projects**"_ | Understandable, but connotes hobby-scale and would make a serious open-source contribution feel diminished |
| _"today let's do your **links**" / "your **online presence**"_ | No system uses either. And per §1–2 there is nothing to *do* — a link is one field in the header, not a chunk of work worth a session |

Sources: [NN/g on navigation labels](https://www.nngroup.com/articles/fixing-bad-intranet-navigation/) ·
[PMI standard for portfolio management](https://www.pmi.org/learning/library/pmi-standard-portfolio-management-8216) (**not directly fetched — 403**)

---

## 7. Q7 — are awards, publications, volunteering and patents in or out?

**Out. The evidence is consistent, and #146's deferral was right** — though not for the reason the
deferral gave. They are not "the same class, shape one and stop"; they are **siblings of Projects in
every enumerated list we found**, which is a stronger reason to keep them separate.

| Source | Where they sit relative to Projects |
|---|---|
| **HR Open `SectionTypeCodeList`** | All **peers** of `Projects` in one flat enum: `Activities, Experience, Hobbies, Honors and Awards, Languages, Leadership Experience, Military Service, Professional Affiliations, Patents, Projects, Publications, Recommendations, References, Security Credentials, Volunteer and Community Work, Other` |
| **LinkedIn** | `Projects` is **Recommended**; `Volunteer experience`, `Publications`, `Patents`, `Honors & awards` are all separate **Additional** sections |
| **MIT CAPD** | `Projects` and `Awards & Honors` and `Publications & Presentations` are three separate "Optional Categories" |
| **UPenn (academic)** | `Publications and presentations` is its own standard category; `Honors and awards` its own; no Projects at all |
| **Textkernel Tx** | `PATENTS`, `ARTICLES`, `BOOKS`, `CONFERENCE_PAPERS`, `OTHER_PUBLICATIONS`, `SPEAKING` are all distinct section types |

**The one inconsistency, and it is worth knowing about.** JSON Resume has separate top-level
`volunteer`, `awards` and `publications` arrays **and** a `projects[].type` field whose own example
values are _"'volunteering', 'presentation', 'talk', 'application', 'conference'"_. So JSON Resume
simultaneously says volunteering is its own section and that it is a *type of project*. That is a
genuine design contradiction in the one schema that models this space most completely, and it is the
only evidence found in favour of a wider umbrella. **Weigh it as a warning rather than a
counter-example**: it shows what happens if you let a project have a `type` — the type field starts
eating neighbouring sections.

**One local observation in the same direction:** two of the six CVs put awards *inside* another
element rather than in a section — Kulpakorn's education entries carry `Merit`, `First Class
Honours`, `Dean's Commendation for Academic Excellence`; Giuliana's carries a `Thesis` bullet. So
even where these things have an agreed sibling section, real CVs nest them into the entry they
belong to.

---

## 8. What has no evidence — stated plainly

- **No usability or comprehension research on CV section names exists** that I could find. Every
  naming argument in §6 is indirect.
- **`Selected Projects`, `Side Projects`, `Online Presence` and `Links` have zero support** in any
  schema, ATS, parser or career-service guide read here. They were not rejected; they simply never
  appeared.
- **No primary source on where open-source work belongs.** Only vendor blogs.
- **No published corpus statistic** on how often CVs carry a projects section. The closest thing to
  corpus evidence is Textkernel's omission of `PROJECTS` from its recognised section types, which is
  an inference about their corpus, not a measurement.
- **No evidence at all on the marketer's equivalent** of a projects section.
- **PMI's portfolio definition was not directly fetched** (403). Verify before relying on it.
- **The 17-advert corpus finding was not re-verified** — the advert files are not in this repo.
- **Nothing here says whether a project entry needs dates, an organisation, or a role** — that is
  #147's question, and the evidence in §4 suggests the answer differs between a personal project and
  an open-source contribution.

---

## 9. Liveness register

| Artefact | State on 2026-08-06 |
|---|---|
| `jsonresume/resume-schema` | **Archived 12 Jun 2026** — but as a *move*, not an abandonment. 2.4k stars, 293 forks, 3 open issues |
| `jsonresume/jsonresume.org` (the successor) | **Live and active.** Not archived; 1,514 commits, 51 open issues, 3 open PRs |
| npm `@jsonresume/schema` | Stated by the archived repo to be unchanged and published from the monorepo |
| HR Open 4.6 schemas (`hropentech.org/4.6/…`) | **Live** — every file in this document fetched successfully today, unauthenticated |
| HR Open `SectionTypeCodeList` | Live, **but its description contains an unresolved editorial question mark** — treat as work in progress |
| Europass profile / CV editor | **Live** EU consumer product |
| LinkedIn profile sections | **Live** product. Profile API remains partner-gated |
| Textkernel CV/Resume Parser data model | **Live**, actively documented |
| Textkernel Tx Platform v9 and v10 | **Live**, both versions documented |
| Greenhouse Harvest candidate object | **Live**, docs public on GitHub |

---

## 10. Sources

Every URL was fetched directly during this research unless marked otherwise.

**Local corpus (read natively for this ticket)**
- `data/cvs/ADRIEN MOUNIER SENIOR PROJECT MANAGER CV 2026.pdf`
- `data/cvs/2024-Thomas Chauviere CV.pdf`
- `data/cvs/CV_Piierre_MOUNIER.pdf`
- `data/cvs/Giuliana_DELRE_Resume V3.pdf`
- `data/cvs/Kulpakorn Ngamvijit CV.pdf`
- `data/cvs/Resume_Remy_IM_IT.pdf`

**JSON Resume**
- Schema: https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json
- Archived repo: https://github.com/jsonresume/resume-schema
- Live monorepo: https://github.com/jsonresume/jsonresume.org

**HR Open Standards 4.6**
- `SectionTypeCodeList`: https://www.hropentech.org/4.6/recruiting/json-2020-12/codelist/SectionTypeCodeList.json
- `OtherSectionType`: https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/OtherSectionType.json
- `PersonProfileInclusion`: https://www.hropentech.org/4.6/common/json-2020-12/profile/PersonProfileInclusion.json
- Profile schema index: https://www.hropentech.org/4.6/common/json-2020-12/profile/
- TCP schema index: https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/

**Europass**
- How to complete your profile: https://europass.europa.eu/en/how-complete-my-europass-profile
- FAQ: https://europass.europa.eu/en/faq?page=2

**LinkedIn**
- Add sections to your profile: https://www.linkedin.com/help/linkedin/answer/a540837/add-sections-to-your-profile
- Featured section: https://www.linkedin.com/help/linkedin/answer/a550399/manage-featured-samples-of-your-work-on-your-linkedin-profile
- Add or remove a website: https://www.linkedin.com/help/linkedin/answer/a548010

**Parsers and ATS**
- Textkernel CV/Resume data model: https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
- Textkernel Tx parser output (v9): https://developer.textkernel.com/tx-platform/v9/resume-parser/overview/parser-output/
- Textkernel Tx parser output (v10): https://developer.textkernel.com/tx-platform/v10/resume-parser/overview/parser-output/
- Greenhouse candidate object: https://raw.githubusercontent.com/grnhse/greenhouse-api-docs/master/source/includes/harvest/_candidates.md
- Greenhouse Harvest docs: https://developers.greenhouse.io/harvest.html

**Career services and professional bodies**
- Harvard OCS, Resumes & Cover Letters: https://static1.squarespace.com/static/592b51c18419c2e1dd15123b/t/636e9bd189d2e53f6a7b693f/1668193233792/undergrad_resumes_and_cover_letters.pdf
- MIT CAPD career toolkit: https://cdn.uconnectlabs.com/wp-content/uploads/sites/123/2025/01/MIT-CAPDs-Career-Toolkit-Crafting-an-effective-resume.pdf
- MIT CAPD resumes: https://capd.mit.edu/resources/resumes/
- UPenn, CVs for faculty job applications: https://careerservices.upenn.edu/application-materials-for-the-faculty-job-search/cvs-for-faculty-job-applications/
- AIGA Baltimore, resume writing for designers: https://baltimore.aiga.org/resume-writing-guidance-for-designers/
- JobsDB Hong Kong, engineer CV sample: https://hk.jobsdb.com/career-advice/article/resume-cv-sample-engineer-position

**Naming and terminology**
- NN/g, bad intranet navigation labels: https://www.nngroup.com/articles/fixing-bad-intranet-navigation/
- PMI, standard for portfolio management (**not directly fetched — 403**): https://www.pmi.org/learning/library/pmi-standard-portfolio-management-8216

**Open source on a CV (secondary only — no primary source found)**
- https://www.visualcv.com/open-source-contributions-on-resume/
- https://enhancv.com/blog/open-source-on-resume/

---

## Appendix — pages that refused automated fetch

Recorded so a future session does not repeat the work:

- `pmi.org/learning/library/*` — **403**. PMI's portfolio definition had to be taken from search
  results summarising the page.
- `robertwalters.com.hk/insights/career-advice/e-guide/how-to-write-a-cv.html` — **403**. This was
  the intended primary source for Hong Kong recruiter guidance; JobsDB Hong Kong was used instead.
- `hindawi.com/journals/ahci/2023/6044007/` — **402 Payment Required**. This paper covers *variation
  in section heading labels across resumes*, which is precisely Q1, and would be the best available
  corpus evidence. **Worth retrieving through an institutional or open mirror before Q1 is treated
  as closed.**
- `content.mycareersfuture.gov.sg/*` — pages fetch but return only navigation chrome; the article
  bodies did not render. Singapore government CV guidance remains **unread** and is the largest
  outstanding gap for our own market.
- Harvard and MIT PDFs would not render through the fetch tool and had to be extracted locally with
  `pdftotext`; the tool's PDF page-rendering path requires poppler, which is unavailable in this
  environment, but `pdftotext` itself is on PATH.
