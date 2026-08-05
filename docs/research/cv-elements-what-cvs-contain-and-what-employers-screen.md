# CV elements: what real CVs contain, and what employers actually screen on

_External research for #130 ("which elements are in v1"), under wayfinder map #127. Unlike the other
docs in `docs/research/`, this one is **not** derived from our corpus — it is read against outside
primary sources, precisely because our own evidence base (6 CVs, 17 adverts) is too thin to decide a
schema on. Compiled 2026-08-04._

**Our starting position, which this doc tests:** across 6 real CVs — education 6/6, work history 6/6,
skills 5/6, languages 4/6 (always with a level, using 9 different level words), certifications 1/6.

---

## How to read the evidence grades

Every claim below is tagged. The grades are not decoration — several of the most-quoted numbers in
this field are **C** or **D**, and one widely-cited figure turned out to be unfindable at source.

| Grade | Means |
|---|---|
| **A** | Standards body, regulator, or a vendor's own machine-readable schema. Verifiable, not opinion. |
| **B** | Published research with a stated sample and method (Cedefop, HBS/Accenture, Appcast, Ladders). |
| **C** | Vendor analytics with a stated sample but no published method (resume-builder studies). |
| **D** | **No good evidence found.** Stated as such, never filled in with a plausible guess. |

**A systematic bias that affects every frequency number in section 1, and you should not forget it:**
every large-sample study of "what's on a resume" is built on **resume-builder user data** — Europass,
Kickresume, Zety, resume.io. The builder's own template decides which sections exist and prompts the
user to fill them. So those numbers measure *what a form offered and how many people completed it*,
not *what a person would volunteer unprompted*. Our 6 real CVs are tiny but unbiased on exactly that
axis. Where the two disagree, neither is automatically right.

---

## 1. What sections real CVs contain, and how often

### 1.1 The best single dataset: Europass CV Insights (grade B)

Cedefop/European Commission analysed real Europass CVs submitted June–September 2019: **392,812
unique CVs collected, 353,518 qualified for analysis**
([Europass CV Insights Report, Cedefop](https://pub5600.cedefop.europa.eu/results/survey_report/epas_survey.html)).

| Element | Finding |
|---|---|
| Work experience | **12% reported no work experience at all.** 23% listed more than 5 entries. |
| Education | ~two-thirds declared a **tertiary** qualification (the report does not give a section-presence rate) |
| Languages | **85%+** listed English among their languages |
| Driving licence | **~7%** (of which 95% class B) |
| ICT certificates | **~7%** |
| Digital skills | Present but unquantified; "1 in 20 uses Microsoft Office" |
| Population | Average age 28, 94% under 45, 24% currently studying, 44% employed, heavily Italy-skewed |

**Caveats that matter:** European, young, and Italy-dominated. Europass is a form with fixed sections,
so "did not fill in" ≠ "would not have written it". And it is not our market.

### 1.2 Other large samples (grade C — sample stated, method not published)

| Source | Sample | What it found |
|---|---|---|
| [Kickresume resume statistics](https://www.kickresume.com/en/blog/resume-statistics/) | 176,220 resumes built on their platform in 2022 | **Only 37% included a summary/objective.** 69% were 200–400 words (one page). 93% used at least one action verb. 45% wrote no cover letter. **No section-frequency data for skills, languages, certifications, education or work history** — despite being widely cited for it. |
| [resume.io skills analysis](https://resume.io/blog/skills-analysis-resume) | ~7 million resumes, 30 countries, Q2 2023 | Most-listed skills globally: teamwork 24%, communication 22%, MS Office 22%, fast learner 18%, adaptability 16%. Four of the top five are soft skills. By country: communication on 94.3% of Australian resumes, 84.1% US, 66.5% UK; Finland's *top* skill reaches only 8.8%. |
| [Zety](https://zety.com/blog/state-of-resume) | Not verified at source | ~22% of resumes carry a certification section. **Flagged as unconfirmed** — I could not load the source page (timeout); the figure comes from a search snippet, not the study itself. |

The resume.io country figures (94.3% Australia vs 24% global for the same skill) are internally
inconsistent as reported, so treat that study as **directional on ranking only**, not on levels.

### 1.3 Market breakdown — the honest answer

**Grade D — no good evidence found for Hong Kong or Singapore.** I found no study, government
dataset, or vendor analysis that measures section frequency on CVs in our actual market. Every
large-sample dataset is US/EU/Australia-weighted. Recruiter-guidance blogs for HK/SG exist in
quantity but are SEO content with no sample behind them, and I have deliberately not cited them as
evidence.

What *is* solid for APAC is the **regulatory** picture, which tells you which personal fields are
being actively discouraged (see §2.4). That is real, citable, and directly relevant.

For **France/Europe**, the Europass data above is the best available, plus a live discrimination
debate around photos and identity fields: France's *Défenseur des droits* barometer reports **79% of
jobseekers believe their physical appearance weighs with recruiters**, and France ran state
experiments on anonymised CVs (name, photo, origin, address, age removed)
([Evaluation de l'impact du CV anonyme](https://www.centre-inffo.fr/IMG/pdf/rapport_cv_anonyme.pdf)).
**Grade D on the actual prevalence of photos on French CVs** — widely asserted, never measured in
anything I could find.

### 1.4 What this supports

- **Near-universal:** name + contact, work history, education. But "near" is doing work — 12% of a
  353k-CV sample had no employment entries at all.
- **Common:** skills, languages (especially outside monolingual markets).
- **Uncommon:** certifications (~7% ICT certs in Europass; ~22% any certification per Zety, unverified),
  driving licence (~7%), summary/objective (37%).
- **Rare / no reliable measurement:** publications, patents, military service, security clearance,
  references-in-full, awards. Parsers model all of these (§3), which tells you they occur — not how often.

---

## 2. What employers screen on

The important distinction is not "ATS vs human". It is **what is a machine-readable field**, **what is
a machine-filterable rule**, and **what a human reads**. These are three different things and the
industry conflates them constantly.

### 2.1 (a) What an ATS filters on mechanically

**The "75% of resumes are auto-rejected by the ATS" claim is not supported by any traceable source**
and should not drive our design. Greenhouse's own product documentation is explicit: the *only*
automatic rejection it performs comes from **knockout questions** — the employer-configured
application questions with a disqualifying answer
([Greenhouse Support: Auto-reject](https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject)).
Nothing in the resume itself triggers a rejection. (Grade A for the mechanism; grade C for the
debunking commentary around it.)

What employers *do* configure as filters, measured properly, comes from HBS/Accenture's **Hidden
Workers: Untapped Talent** — a survey of **>8,000 workers and >2,250 executives across the US, UK and
Germany**, 2020 ([HBS white paper, Fuller & Raman, 2021](https://www.hbs.edu/ris/Publication%20Files/hiddenworkers09032021_Fuller_white_paper_33a2047f-41dd-47b1-9a8d-bd08cf3bfa94.pdf)) — grade B:

- **63% of employers use a recruitment management system** (75% US, 58% UK, 54% Germany).
- Of those, **94% use it to filter or rank middle-skills candidates**, 92% for high-skills.
- Filter criteria the survey asked about, verbatim: *academic performance (level of attainment);
  professional/vocational credentials; skills; years of experience; career progression (previous job
  titles and/or employers); employment gaps in resume; working style; referral; assessment; criminal
  record; possession of government-issued identification; work authorization/immigrant status.*
- **48% of employers filter middle-skills candidates on an employment gap of more than six months.**
- **88% of employers agree qualified high-skills candidates are vetted out for not matching the exact
  job-description criteria; 94% for middle-skills.**

(I extracted the report's Figure 7 chart, which gives a percentage per criterion, but the PDF
extraction lost the label-to-value mapping. I am therefore **not** quoting per-criterion percentages —
only the prose findings above, which are unambiguous.)

**Reading this for JobCrush:** the machine-filterable surface is dates, credentials, attainment level,
job titles/employers, years of experience, and work authorisation. Notice how much of that is
*structured facts we currently don't keep* — dates and employers especially.

### 2.2 Which fields ATS platforms actually parse into structured columns

This is the highest-confidence part of the whole document: these are the vendors' own schemas (grade A).

| Platform | Structured CV data it holds |
|---|---|
| **Greenhouse** | Education only: `school_name_id`, `degree_id`, `discipline_id`, `start_date` {month, year}, `end_date` {month, year} — school/degree/discipline are **IDs into Greenhouse-maintained controlled lists** (`GET /v1/schools`, `/v1/degrees`, `/v1/disciplines`). Plus `POST /add_education` and `/add_employment` on a candidate. Application fields: `first_name`, `last_name`, `email`, `phone`, `resume`, `cover_letter`, custom questions (`input_text`, `textarea`, `multi_value_single_select`, `multi_value_multi_select`, `input_file`, `input_hidden`), and EEO `demographic_answers`. **No skills field. No certifications field. No languages field. No grade field.** ([Harvest API](https://developers.greenhouse.io/harvest.html), [Job Board API](https://developers.greenhouse.io/job-board.html)) |
| **Lever** | Essentially none. Contacts carry name, headline, location, emails, phones. Applications carry name/email/phone/company plus `customQuestions`. The `resume` field is deprecated in favour of a file-download endpoint. **No structured education or employment objects.** ([Lever API docs](https://hire.lever.co/developer/documentation)) |
| **iCIMS** | Person Profile education field group: `Degree` (list), `educationcity`, `educationcountry`, `educationstartdate`, `educationstate` — **no institution name, no end date, no grade** in the published data model. Plus `birthdate`, `availabledate`, `currentposition`, `currentindustry`, address history, alias history. No structured skills/certifications/languages in the published model. ([iCIMS Person Profile data model](https://developer-community.icims.com/applications/applicant-tracking/ats-data-models/person-profile)) |
| **SmartRecruiters** | Published candidate schema excerpt gives `id`, `uuid`, `firstName`, `lastName`, `email`, `phone`, `addressLine`; fuller education/experience objects are referenced but not published on the pages I could reach. **Grade B, partial.** ([SmartRecruiters candidate docs](https://developers.smartrecruiters.com/docs/candidate.md)) |
| **SEEK (JobsDB HK / JobStreet SG)** | On application, SEEK exports "structured details of the candidate's employment history, education" as a snapshot of the SEEK Profile, plus resume/cover-letter attachments. Profile = personal summary, career history, skills, qualifications, licences and certifications, role preferences, minimum salary. **Only name and email are mandatory.** ([SEEK Developer: exporting candidate profiles](https://developer.seek.com/use-cases/application-export/candidate-profiles)) |
| **Workday** | The candidate's "My Experience" page holds Work Experience, Education and document upload; an uploaded resume auto-fills work history and education. **Grade C — I could not reach primary Workday documentation** (doc.workday.com returned 404 on the recruiting paths I tried, and Workday Community is gated). Everything I found was university IT instruction pages and SEO blogs. Treat Workday's exact field list as **unverified**. |
| **Taleo (Oracle)** | **Grade D — no accessible primary documentation found.** |

**The single most important finding in this table:** a mainstream ATS's structured education record is
*poorer* than a CV's education section — controlled-vocabulary IDs plus month/year, no grade, no
honours, no thesis, no free text. Greenhouse holds no structured skills, certifications or languages
at all; Lever holds essentially nothing.

So "capture the maximum from a CV" and "be ATS-compatible" are **two different goals**. Maximum
capture is for the career record and for our own tailoring; the ATS surface is much narrower and
already well-defined. Do not let one justify the other.

### 2.3 What parsers extract (a much larger surface than what ATSs store)

Textkernel — which acquired Sovren, and is the parsing engine behind a large share of the market —
publishes its full output schema (grade A):

**Newer model** ([Textkernel candidate data model](https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/)):
`personal` (title, firstName, middleName, lastName, completeName, initials, `birthDate`, `birthPlace`,
`nationality` normalised to ISO 3166-1 alpha-2, `nationalId`, `gender` normalised to ISO 5218,
`phones[]` {number, type}, `emails[]`, `personalUrls[]` {type: linkedin, github…}, full address,
`driversLicenses[]`); `employmentHistory`; `educationHistory` (degrees + courses); `skills`
(computerSkills / languageSkills / softSkills / otherSkills); `certifications`; `summary`
(`totalExperienceYears`, `currentJob`, `currentEmployer`, `highestDegree`); `other` (`hobbies[]`,
`profilePicture` as base64, `documentText`, `documentHtml`).

**Older Tx platform v9** ([parser output](https://developer.textkernel.com/tx-platform/v9/resume-parser/overview/parser-output/))
additionally exposes: `sov:MaritalStatus`, `sov:VisaStatus`, `sov:PassportNumber`,
`sov:NationalIdentityNumber`, `sov:CurrentSalary` / `sov:RequiredSalary` (with currency),
`sov:WillingToRelocate`, `sov:PreferredLocation`, `PublicationHistory`, `PatentHistory`,
`MilitaryExperience` (country, branch, rank, dates), `SecurityCredentials`, `References`,
`Associations`.

One design detail worth stealing: Textkernel tags every skill and certification with **`foundIn`** —
the ID of the employment or education item the fact was found in. Provenance is a first-class field
in the parser, not an afterthought. Our claim graph should treat it the same way.

### 2.4 (b) What a human reads and judges

- **Time.** Ladders' 2018 eye-tracking update: recruiters spend an average of **7.4 seconds** on an
  initial resume screen (up from ~6s in 2012); they look at current title and company, then the
  previous one, then move right to the dates, then drop to education. Simple layouts with clear
  section headers and bold job titles performed well; multi-column, cluttered layouts performed badly
  ([Ladders press release](https://www.prnewswire.com/news-releases/ladders-updates-popular-recruiter-eye-tracking-study-with-new-key-insights-on-how-job-seekers-can-improve-their-resumes-300744217.html);
  [HR Dive coverage](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/)).
  **Grade B with a caveat:** the public materials never disclose how many recruiters or resumes were
  tested, and the study PDF is now behind a 403. The 7.4-second figure is universally repeated and
  never independently replicated. Use it as a design principle, not as a measurement.
- **What employers say they look for.** NACE's Job Outlook employer surveys: **only 38.3% now use GPA
  as a screening criterion — down 35% over five years**; **70% report skills-based hiring**; ~90% seek
  evidence of problem-solving and ~80% teamwork on the resume; in Job Outlook 2016, 80.1% looked for
  evidence of leadership
  ([NACE](https://www.naceweb.org/talent-acquisition/candidate-selection/what-are-employers-looking-for-when-reviewing-college-students-resumes)).
  Grade B. Note this is a **graduate-hiring** survey — our IT/PM market is mid-career, so transfer it
  with care.

### 2.5 (c) Decoration — and the regulators who say so

Two APAC regulators state directly which CV fields are *not* legitimate screening input. These are the
strongest market-specific sources in this document (grade A).

**Hong Kong — PCPD Code of Practice on Human Resource Management** (in force 2001, revised April 2016;
[full text PDF](https://www.pcpd.org.hk/english/data_privacy_law/code_of_practices/files/PCPD_HR_Booklet_Eng_AW07_Web.pdf)):

- §2.2.2 — data must be "adequate but not excessive in relation to the purpose of recruitment".
  Relevant data "may include **work experience, job skills, competencies, academic/professional
  qualifications, good character** and other attributes required for the job."
- §2.2.3 — an employer may collect an HKID **number** only if four conditions are all met.
- §2.2.4 — an employer "should not collect a **copy** of the Hong Kong Identity Card of a job applicant
  during the recruitment process unless and until the individual has accepted an offer of employment."
- §2.7.1 — "recording the details of a candidate's **outside activities and interests** might be
  excessive unless the employer can demonstrate that such detail is relevant to the inherent
  requirements of the job."

**Singapore — Tripartite Guidelines on Fair Employment Practices**
([TAFEP PDF](https://www.tal.sg/tafep/-/media/tal/tafep/getting-started/files/tripartite-guidelines.ashx)),
verbatim: "examples of information that are **not relevant** to ask in the application form would be
**age, date of birth, gender, race, religion, marital status and family responsibilities** including
whether an applicant is pregnant or has children, **and disability**." On NRIC: "As NRIC details can be
telling of age… employers should accept as an alternative and provide the 'NRIC/Passport Number'
option." And: "Employers should not request for other personal details, for example **photograph and
national service liability**."

**This is a live design constraint, not background colour.** Textkernel *does* parse date of birth,
gender, marital status, nationality and photo. Singapore's guidelines say employers should not ask for
several of those. If JobCrush captures them into a career record and then surfaces them into a
generated CV for an SG or HK role, we are pushing the candidate toward exactly the fields the local
regulator tells employers to stop collecting.

---

## 3. What each common element actually carries

Schemas below are grade A (published specs). **Frequency of each sub-field on real CVs is grade D
almost everywhere** — that is the single biggest hole in the available evidence, and I want it stated
plainly rather than papered over.

### Education

| Sub-field | JSON Resume | Textkernel | Greenhouse | Present on real CVs? |
|---|---|---|---|---|
| Institution | `institution` | `institute` + location/city/country | `school_name_id` (controlled list) | Assumed universal — **not measured** |
| Qualification | `studyType` | `degreeName` + normalised local/international codes | `degree_id` (controlled list) | " |
| Field of study | `area` | (in degree description) | `discipline_id` (controlled list) | " |
| Dates | `startDate`, `endDate` | `startDate`, `endDate` | `start_date`/`end_date` {month, year} | " |
| Grade / class | `score` | `gradePointAverage` (v9: `sov:NormalizedGPA`, 0.0–1.0) | **absent** | **Grade D.** NACE: only 38.3% of employers still screen on GPA |
| Completion status | — | `diplomaCode` (1 obtained / 2 not obtained / 3 ongoing) | — | Valuable and under-modelled elsewhere |

Sources: [JSON Resume schema](https://jsonresume.org/schema), Textkernel (above), Greenhouse (above).

### Employment

Textkernel: `jobTitle`, `organization`, `location`/`city`/`region`/`country`, `startDate`, `endDate`
(or `__NOWSTRING__` for current), computed `years`/`months`, `isCurrentExperience`,
`isLatestExperience`, `description`, and optional occupation classification to **O*NET 2019** and
**ISCO-08** codes. JSON Resume: `name`, `position`, `url`, `startDate`, `endDate`, `summary`,
`highlights[]`.

The *computed* fields are the interesting ones — total experience, current employer, is-this-current.
Those are exactly what an employer's filter keys on (HBS: years of experience, career progression,
employment gaps) and exactly what a bag of sentences cannot answer.

### Certifications

| Sub-field | JSON Resume | Textkernel v9 | Open Badges 3.0 |
|---|---|---|---|
| Name | `name` | `Name` | achievement `name` |
| Issuer | `issuer` | (in description) | `issuer` |
| Award date | `date` | `FirstIssuedDate` | date of achievement |
| Expiry | **absent** | `ValidFrom` / `ValidTo` | `expires` |
| Credential ID / URL | `url` only | — | cryptographically verifiable assertion |

**How often does a real CV state an expiry? Grade D — no evidence found, at all.** What I can tell you
is that expiry is *real* for the certifications that matter in our IT/PM market, so the field is not
hypothetical: PMP is valid **3 years** with 60 PDUs
([PMI CCR Handbook](https://www.pmi.org/-/media/pmi/documents/public/pdf/certifications/ccr-certification-requirements-handbook.pdf)),
AWS **3 years** ([AWS recertification policy](https://aws.amazon.com/certification/policies/recertification/)),
CompTIA **3 years** ([CompTIA renewal policy](https://www.comptia.org/en-us/resources/test-policies/continuing-education-policies/certification-renewal-policy/)),
CISSP **3 years** / 120 CPE, Scrum Alliance CSM **2 years**
([Scrum Alliance renewal](https://www.scrumalliance.org/get-certified/renewing-certifications)).
Note that **JSON Resume — the community standard — has no expiry field at all**, which is decent
evidence that most tooling doesn't bother.

Credential ID: modelled properly only in [Open Badges 3.0 / W3C Verifiable Credentials](https://www.imsglobal.org/spec/ob/v3p0),
which is a verification ecosystem, not a CV convention. **Frequency on real CVs: grade D.**

### Skills

Textkernel splits skills four ways — `computerSkills`, `languageSkills`, `softSkills`, `otherSkills` —
and each non-language skill carries `skill`, `level`, `years`, `lastUsed`, `foundIn`, plus optional
taxonomy codes. Tx v9 exposes `@totalMonths`, `@lastUsed` and `@whereFound` per skill. JSON Resume:
`name`, `level`, `keywords[]`.

**But:** `level` is whatever the CV said. There is no standard behind it (§4.3). And **no mainstream
ATS stores a structured skill at all** (§2.2). Skills matter for search and ranking, not for the
application record.

### Languages

Textkernel's newer model normalises the language itself to **ISO 639-1** and the level to its own
"Textkernel Language Skill Level" code list, plus `years`, `lastUsed`, `foundIn`. JSON Resume has only
`language` + `fluency` (freeform string; the schema's own example is "Native speaker").

**Contradiction worth noting:** Textkernel's older Tx v9 output documentation states language
proficiency is **not structured — freeform if present**. So the dominant parser historically threw the
level away, and only the newer model normalises it. If our concern is "will the level survive into an
employer's system", the honest answer is: **often not.**

---

## 4. Level and grade vocabularies — does a standard exist?

### 4.1 Languages — yes, and it is unambiguous

The **CEFR** (Council of Europe) is the standard: six levels **A1, A2, B1, B2, C1, C2**, self-assessed
across five sub-skills — listening, reading, spoken interaction, spoken production, writing
([CEFR self-assessment grid, Council of Europe](https://www.coe.int/en/web/common-european-framework-reference-languages/table-2-cefr-3.3-common-reference-levels-self-assessment-grid);
[Europass grid PDF](https://europass.europa.eu/system/files/2020-05/CEFR%20self-assessment%20grid%20EN.pdf)).
Europass **requires** CEFR levels and gives a self-assessment tool rather than accepting freeform words
like "fluent" or "native"
([Europass: how to self-assess your language skills](https://europass.europa.eu/en/how-self-assess-your-language-skills)).

**This confirms our 6-CV finding, it does not contradict it.** A rigorous standard exists; people
writing CVs mostly ignore it. Nine different level words across four CVs is exactly what you would
expect when the standard is real but unenforced outside EU tooling. **Grade D on how often real CVs
use CEFR** — no measurement found anywhere, which means our own corpus is currently the best evidence
that exists on this question, for us.

### 4.2 Degree classifications — a standard for *level*, none for *grade*

**Level is standardised.** UNESCO **ISCED 2011** gives levels 0–8, with 5 = short-cycle tertiary,
6 = bachelor's, 7 = master's, 8 = doctoral
([ISCED 2011, UNESCO](https://www.openemis.org/wp-content/uploads/2018/04/unesco-international-standard-classification-education-isced-2011-en.pdf)).
Textkernel normalises every degree to both a local and an "international" education level.

**Grade is not standardised, and is not translatable between markets:**

| Market | Vocabulary |
|---|---|
| UK | First / Upper Second (2:1) / Lower Second (2:2) / Third / Pass |
| France | `mention` on 0–20: Passable / Assez bien / Bien / Très bien |
| Singapore (NUS, since 2014) | Honours (Highest Distinction) / (Distinction) / (Merit) / Honours — replacing First / Second Upper / Second Lower / Third ([NUS transcript grade legend](https://www.nus.edu.sg/registrar/docs/info/administrative-policies-procedures/transcript-information-grade-legend.pdf)) |
| US | GPA on 4.0 |
| Hong Kong | Institution-specific honours classifications |

Note the trap for our market specifically: **Singapore renamed its honours classes in 2014**, so a
Singaporean CV can carry either vocabulary depending on graduation year, and both are correct. Any
normalising we do must not "fix" one into the other.

### 4.3 Skill proficiency — **no standard exists**

This is a clean negative result and it is worth stating loudly.

- **ESCO** (EU) classifies skills and competences but has **no proficiency dimension**. Its
  "skill reusability level" is about transferability across occupations, not about how good you are
  ([ESCO: skill reusability level](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/skill-reusability-level)).
- **DigComp** (EU JRC) does define proficiency — foundation / intermediate / advanced / highly
  specialised, expanded to 8 levels in DigComp 2.1 — but **only for digital competences**
  ([DigComp, JRC](https://joint-research-centre.ec.europa.eu/projects-and-activities/education-and-training/digital-transformation-education/digital-competence-framework-digcomp/all-editions-digcomp-and-related-jrc-publications_en)).
- **LinkedIn retired Skill Assessments in 2024** and removed the badges from member profiles
  ([LinkedIn Help](https://www.linkedin.com/help/linkedin/answer/a1690529)) — the largest attempt at
  standardising skill proficiency was withdrawn.
- **JSON Resume** has a freeform `level` string. **Textkernel** has a `level` field populated from
  whatever the CV said.

So: beginner/intermediate/advanced/expert is a convention, not a standard, and nothing downstream
interprets it consistently.

---

## 5. How many questions before a candidate abandons

**Read this section knowing the evidence is about a different act than ours.** All of it measures
*applying to a specific job*, where the reward is speculative and the applicant is one of hundreds.
JobCrush's onboarding is *building your own career record*, where the reward is personal and reusable.
**Grade D on whether these numbers transfer** — I found no study of abandonment in a
build-your-own-profile flow. That is a genuine unknown and it should not be smoothed over.

What the evidence does say:

- **CareerBuilder (2016):** "60 percent of job seekers quit in the middle of filling out online job
  applications because of their length or complexity." Cited causes: length, complexity, too many
  screens, being asked to re-enter work history
  ([SHRM coverage](https://www.shrm.org/in/topics-tools/news/technology/study-job-seekers-abandon-online-job-applications)).
  Grade B; the underlying sample size is not published.
- **Appcast**, via the same SHRM article: completion rates **drop by nearly 50% when an application
  asks 50+ questions versus 25 or fewer**; conversion can rise **up to 365%** when the application is
  cut to five minutes or less; the study tracked **500,000 job seekers and 30,000+ completed
  applications.** Grade B.
- **A caution on a figure you will see quoted.** The "12.47% completion under 5 minutes vs 3.61% over
  15 minutes" split circulates widely attributed to Appcast. **I could not find it in any primary
  Appcast document.** I read the full 2025 Recruitment Marketing Benchmark Report (281 million clicks,
  25.6 million applies, 1,300+ US employers —
  [PDF](https://info.appcast.io/hubfs/FINAL%20CONTENT%20PDFS/Whitepapers/%5BWhitepaper%5D%20Appcast%20Recruitment%20Benchmark%20Report%202025.pdf))
  and it contains **no application-length-versus-conversion analysis at all** — only a one-line best
  practice ("Make the apply process simpler: forgo the long questions"). Treat the 12.47/3.61 split as
  **unsourced**.
- **Academic, and the most transferable finding here.** Galesic & Bosnjak, *Effects of Questionnaire
  Length on Participation and Indicators of Response Quality in a Web Survey*, Public Opinion
  Quarterly 73(2):349–360, 2009
  ([Oxford Academic](https://academic.oup.com/poq/article-abstract/73/2/349/1939196)). They
  manipulated the **stated** length (10 / 20 / 30 minutes) and found: "the longer the stated length,
  the fewer respondents started and completed the questionnaire", and answers to later questions were
  "faster, shorter, and more uniform" than early ones.

**The operative insight for staging is the last one, and it is not about a count of questions.** It is
that (a) the *announced* cost drives the drop-off, and (b) answer quality decays with position
regardless. So: don't announce a long form, and put the questions whose answers you most need to be
*accurate* early — not last.

---

## 6. Contradictions with our 6-CV findings

Highest-value section. Each of these is a place where outside evidence disagrees with, or dangerously
over-generalises, what we measured.

**1. "Work history 6/6" must not become a schema assumption.** Europass, n=353,518: **12% had no work
experience at all**. A CV with zero employment entries is a real, common case — students, career
changers, returners. If v1 assumes at least one employment entry, it breaks for roughly one CV in
eight. (Grade B contradiction, and the strongest one in this document.)

**2. "Education 6/6" is softer than it looks.** Europass reports only ~two-thirds declaring tertiary
education. That is a different measurement (tertiary attainment, not section presence), so it is a
**caution, not a refutation** — but 6/6 on a sample of 6 gives no basis for treating education as
mandatory.

**3. "Certifications only 1/6" is not a reason to defer them.** Low frequency, high consequence:
credentials are one of the criteria employers explicitly configure their systems to filter on
(HBS/Accenture), and licences/certifications are among the few things parsers normalise against a
taxonomy. Europass agrees on the frequency (~7% ICT certificates), so our 1/6 is if anything on the
*high* side — but frequency is the wrong test for this element.

**4. "Languages always with a level" — true on our CVs, but the level often dies downstream.**
Textkernel's Tx v9 documentation says language proficiency is **not structured in the output —
freeform if present**. Only their newer model normalises it. Capturing the level is right for our own
career record; expecting it to survive into an employer's system is not.

**5. "Skills 5/6" — but skills are not an application-form field anywhere.** Greenhouse, Lever and
iCIMS hold no structured skill object. Skills matter for recruiter search and ranking; they are not
part of the record an ATS keeps. This changes *why* we capture skills, not *whether*.

**6. The assumption most worth challenging: that richer capture means better ATS compatibility.**
It doesn't. Greenhouse's structured education is *poorer* than a CV's — controlled-vocabulary IDs plus
month/year, no grade, no honours, no free text. Maximum capture serves the career record and our own
tailoring. ATS compatibility is a separate, narrower, already-specified target. Conflating them will
produce a schema that is over-built in the wrong places.

**7. A market-specific trap our corpus cannot see.** Parsers extract date of birth, gender, marital
status, nationality and photo. Singapore's Tripartite Guidelines tell employers **not to ask for**
age, date of birth, gender, race, religion, marital status, family responsibilities, disability,
photograph or national service liability; Hong Kong's PCPD restricts HKID collection and calls
interests/activities potentially "excessive". Capturing these fields into a career record is
defensible; **emitting them onto a generated CV for an SG/HK role is not.** That is a capture-versus-
render distinction v1 should make deliberately.

**8. Photo.** Textkernel's older documentation says photo is not captured; the newer model returns
`profilePicture` as base64. So the vendor's own answer changed. **Grade D on prevalence by market.**

---

## 7. Where there is no good evidence — say so, don't fill it in

- **Section frequency on Hong Kong or Singapore CVs.** Nothing. Not a study, not a dataset, not a
  government statistic. Our market is unmeasured in the public literature.
- **How often a certification entry carries an expiry date on a real CV.** Nothing.
- **How often a certification carries a credential ID.** Nothing.
- **How often a skill carries a proficiency level on a real CV.** Nothing direct.
- **The distribution of language-level vocabulary on real CVs.** Nothing. Our "9 different level words
  across 4 CVs" is currently the best evidence available to us on this question, from anyone.
- **Photo prevalence by market** (France, HK, SG). Widely asserted, never measured in anything citable.
- **Abandonment in a build-your-own-profile flow**, as distinct from a job application. Nothing.
- **Workday's and Taleo's exact structured field lists.** Primary documentation is gated or 404s.
- **Any replication of the 7.4-second eye-tracking figure**, or its sample size.

---

## 8. What the evidence supports for a v1 element list

_This section is my reading of the evidence above, not new evidence. #130 owns the decision._

**Tier 1 — carry structured, because both the CV has it and someone downstream filters on it:**
employment history (employer, title, start/end dates, current flag, location, description) and
education (institution, qualification, field, dates, completion status). These are the only two things
every ATS that stores anything at all stores, and they are what recruiters look at in their 7.4
seconds. Dates are load-bearing: employment gaps are an explicit filter for ~48% of employers.

**Tier 2 — carry structured, because the cost of missing them is high even though frequency is low:**
certifications (name, issuer, award date, expiry, credential ID) and languages (language + level, level
kept verbatim *and* mapped). Certifications are a configured filter criterion; languages are a
first-class demand in our APAC market.

**Tier 3 — carry, but know nothing downstream will consume the structure:** skills with optional
level/last-used/years. Valuable for our own tailoring and for recruiter search; not an ATS field.

**Tier 4 — capture-but-don't-render, deliberately:** date of birth, nationality, gender, marital
status, photo, ID numbers. Parsers read them; APAC regulators tell employers not to ask for them.
Whatever v1 does here should be an explicit decision with the regulator text in front of it, not a
default.

**Two things worth designing in from the start, both borrowed from evidence rather than instinct:**
provenance per fact (Textkernel's `foundIn` — every skill and certification tagged with the employment
or education item it came from), and a completion/verification status per qualification (Textkernel's
`diplomaCode`: obtained / not obtained / ongoing), which most schemas omit and which is exactly the
kind of thing a person's own career record should know.

---

## Sources

**Standards and specifications (grade A)**
- [JSON Resume schema](https://jsonresume.org/schema)
- [HR Open Standards — standards & downloads](https://www.hropenstandards.org/standards) · [LER-RS Resume/CV standard](https://www.hropenstandards.org/ler-rs)
- [CEFR self-assessment grid — Council of Europe](https://www.coe.int/en/web/common-european-framework-reference-languages/table-2-cefr-3.3-common-reference-levels-self-assessment-grid) · [Europass CEFR grid PDF](https://europass.europa.eu/system/files/2020-05/CEFR%20self-assessment%20grid%20EN.pdf) · [Europass: self-assess your language skills](https://europass.europa.eu/en/how-self-assess-your-language-skills)
- [ISCED 2011 — UNESCO](https://www.openemis.org/wp-content/uploads/2018/04/unesco-international-standard-classification-education-isced-2011-en.pdf)
- [DigComp — European Commission JRC](https://joint-research-centre.ec.europa.eu/projects-and-activities/education-and-training/digital-transformation-education/digital-competence-framework-digcomp/all-editions-digcomp-and-related-jrc-publications_en) · [ESCO skill reusability level](https://esco.ec.europa.eu/en/about-esco/escopedia/escopedia/skill-reusability-level)
- [Open Badges 3.0 — 1EdTech](https://www.imsglobal.org/spec/ob/v3p0)

**Vendor schemas (grade A)**
- [Textkernel candidate data model](https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/) · [Textkernel Tx v9 parser output](https://developer.textkernel.com/tx-platform/v9/resume-parser/overview/parser-output/)
- [Greenhouse Harvest API](https://developers.greenhouse.io/harvest.html) · [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html) · [Greenhouse Support: Auto-reject](https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject)
- [Lever API documentation](https://hire.lever.co/developer/documentation)
- [iCIMS Person Profile data model](https://developer-community.icims.com/applications/applicant-tracking/ats-data-models/person-profile)
- [SmartRecruiters candidate object](https://developers.smartrecruiters.com/docs/candidate.md)
- [SEEK Developer: exporting candidate profiles](https://developer.seek.com/use-cases/application-export/candidate-profiles)

**Regulators (grade A)**
- [Hong Kong PCPD — Code of Practice on Human Resource Management](https://www.pcpd.org.hk/english/data_privacy_law/code_of_practices/files/PCPD_HR_Booklet_Eng_AW07_Web.pdf)
- [Singapore TAFEP — Tripartite Guidelines on Fair Employment Practices](https://www.tal.sg/tafep/-/media/tal/tafep/getting-started/files/tripartite-guidelines.ashx)
- [Évaluation de l'impact du CV anonyme (France)](https://www.centre-inffo.fr/IMG/pdf/rapport_cv_anonyme.pdf)

**Research with a stated method (grade B)**
- [Europass CV Insights Report — Cedefop](https://pub5600.cedefop.europa.eu/results/survey_report/epas_survey.html)
- [Hidden Workers: Untapped Talent — Fuller & Raman, HBS/Accenture 2021](https://www.hbs.edu/ris/Publication%20Files/hiddenworkers09032021_Fuller_white_paper_33a2047f-41dd-47b1-9a8d-bd08cf3bfa94.pdf)
- [Galesic & Bosnjak, POQ 73(2):349–360, 2009](https://academic.oup.com/poq/article-abstract/73/2/349/1939196)
- [NACE — what employers look for on resumes](https://www.naceweb.org/talent-acquisition/candidate-selection/what-are-employers-looking-for-when-reviewing-college-students-resumes)
- [Ladders eye-tracking study 2018 — press release](https://www.prnewswire.com/news-releases/ladders-updates-popular-recruiter-eye-tracking-study-with-new-key-insights-on-how-job-seekers-can-improve-their-resumes-300744217.html) · [HR Dive coverage](https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/)
- [SHRM — Study: Most Job Seekers Abandon Online Job Applications](https://www.shrm.org/in/topics-tools/news/technology/study-job-seekers-abandon-online-job-applications)
- [Appcast 2025 Recruitment Marketing Benchmark Report (PDF)](https://info.appcast.io/hubfs/FINAL%20CONTENT%20PDFS/Whitepapers/%5BWhitepaper%5D%20Appcast%20Recruitment%20Benchmark%20Report%202025.pdf) — read in full; contains **no** application-length data

**Certification validity periods (grade A, vendor policy)**
- [PMI Continuing Certification Requirements Handbook](https://www.pmi.org/-/media/pmi/documents/public/pdf/certifications/ccr-certification-requirements-handbook.pdf) · [AWS recertification policy](https://aws.amazon.com/certification/policies/recertification/) · [CompTIA renewal policy](https://www.comptia.org/en-us/resources/test-policies/continuing-education-policies/certification-renewal-policy/) · [Scrum Alliance renewal](https://www.scrumalliance.org/get-certified/renewing-certifications)

**Vendor analytics, sample stated / method not published (grade C)**
- [Kickresume resume statistics — 176,220 resumes, 2022](https://www.kickresume.com/en/blog/resume-statistics/)
- [resume.io skills analysis — ~7m resumes, 30 countries, Q2 2023](https://resume.io/blog/skills-analysis-resume)
- [Zety — state of the resume](https://zety.com/blog/state-of-resume) (**source page did not load; figure unconfirmed**)
- [NUS transcript grade legend](https://www.nus.edu.sg/registrar/docs/info/administrative-policies-procedures/transcript-information-grade-legend.pdf)
- [LinkedIn Help — Skill Assessments no longer available](https://www.linkedin.com/help/linkedin/answer/a1690529)
