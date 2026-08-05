# What a career element is made of — the existing data standards

_Research for wayfinder map #127 / ticket #130. Written 2026-08-04._

_Why this exists: JobCrush is designing a structured career record intended to outlive the uploaded
CV — facts added over years, tailored CVs generated from the record. Other people have already
designed this object. This document reads their answers before we invent our own. It does **not**
recommend a design; §2 lists the decisions that are genuinely open, and those belong to the owner._

**Everything below was read from the specification or schema file itself, not from write-ups about
it.** Field names are quoted exactly as the spec writes them. Where a page blocked automated
fetching, that is flagged inline.

---

## Bottom line

1. **There is a stable, boring core that every standard agrees on.** An education entry, a work
   entry, a certification, a skill and a language have an agreed skeleton. If we build only that, we
   are not being unimaginative — we are being correct.
2. **The disagreements are few, sharp, and all structural.** Five real forks (§2). Each is a choice
   about how much structure to force on a person, and each has a named cost.
3. **Nobody has solved "a career record that grows."** Every CV-shaped standard is a snapshot
   document. The two exceptions are recent and unproven: the **Europass Profile** (a stored profile
   you generate CVs from — exactly our direction, and it works) and **HR Open's Trusted Career
   Profile / LER-RS** (a resume where every fact can carry its own verification — released 2026,
   adoption unknown).
4. **The most transferable single idea we found** is HR Open's date design: rather than one date
   type that tolerates vagueness, it has *typed* precision — a year value and a year-month value are
   different types, and there is a separate "open-ended period" type for "still there". That makes
   "we only know the year" a fact the system knows it knows, rather than a gap.
5. **The single most useful negative finding:** the EU's flagship model (ELM) does not model
   employment history *at all*. It is a learning-and-credentials model. Anyone who tells you "just
   use Europass/ELM" for a career record has not read it.

---

## 0. The field, and how alive each part of it is

| Standard | What it is | Adoption reality |
|---|---|---|
| **JSON Resume** | Community JSON schema for a résumé document | Live but small. The canonical schema repo was **archived read-only on 12 June 2026**; work moved to the `jsonresume.org` monorepo (`packages/schema`), npm `@jsonresume/schema`. ~2.4k stars, 293 forks, 3 open issues. Widely copied as *inspiration* for CV tooling; not used by employers. |
| **Europass / European Learning Model (ELM) v3** | EU's model for learning, qualifications, credentials | ELM is real and mandated in EU credential infrastructure. **But the ELM GitHub repo was archived 14 Feb 2024**; the live artefact is the ELM Browser (v3.3.1) + EU Vocabularies. **ELM contains no work-experience class.** The consumer-facing Europass Profile/CV is separate and widely used by EU jobseekers. |
| **HR Open Standards** (was HR-XML) | Industry consortium, founded 1999; JSON Schema 2020-12 + RDF | **The most complete career-record model anyone has published.** Current release **4.6**, schema files dated May–June 2026. Free download behind an IP agreement + free "Community membership" account; work-in-progress repos are members-only. Real HR/ATS vendor implementation exists but is not publicly enumerable. |
| **schema.org** | Web vocabulary (Google et al.) | Enormous adoption — **but on the employer side** (`JobPosting`), not the candidate side. `Person`/`Occupation`/`EducationalOccupationalCredential` for individuals is barely used in practice. |
| **LinkedIn Profile API** | The de-facto world career record | The data model is real and complete; **the API is effectively closed.** Only *Lite Profile* (name + photo) is available to all developers. Positions, educations, certifications, skills, languages are all "only available to applications that have applied and been approved for a LinkedIn Partner Program". |
| **ATS canonical schemas** (Greenhouse, SmartRecruiters, Lever) | What recruiting systems actually store | Live and dominant, but deliberately thin. Greenhouse and SmartRecruiters keep structured education/employment; **Lever keeps none** — it stores the résumé file. |
| **CTDL** (Credential Engine), **Open Badges 3.0** (1EdTech), **W3C Verifiable Credentials** | Credential-side infrastructure | The serious answer to "who says this is true". Underpins ELM, Open Badges 3.0, and HR Open's Trusted Career Profile. |

Sources: [JSON Resume schema repo](https://github.com/jsonresume/resume-schema) ·
[schema.json](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json) ·
[ELM repo (archived)](https://github.com/european-commission-empl/European-Learning-Model) ·
[ELM Browser](https://europa.eu/europass/elm-browser/) ·
[HR Open 4.6 schemas](https://www.hropentech.org/4.6/) ·
[hropenstandards.org](https://hropenstandards.org/) ·
[LinkedIn Profile Fields index](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile) ·
[LinkedIn Profile API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)

---

## 1. What each standard says each element is made of

### 1.1 A work-experience entry

| | JSON Resume | LinkedIn (`Position`) | HR Open (`EmployerHistoryType` + `PositionHistoryType`) | SmartRecruiters | Greenhouse | schema.org |
|---|---|---|---|---|---|---|
| Employer | `name` — free string, _"e.g. Facebook"_ | `company` (URN) **and** `companyName` (free text) — both optional | `organization` → `OrganizationType` (a full legal-entity object) | `company` — string | `company_name` — string | `Organization` object via `worksFor` |
| Job title | `position` | `title` (localizable) | `title` (per position) | `title` | `title` | `roleName` on `EmployeeRole`, or `jobTitle` on `Person` |
| Dates | `startDate`, `endDate` | `startMonthYear`, `endMonthYear` — _"Does not support 'day' field"_ | `start`, `end`, `current` (from `BaseHistoryType`) | `startDate`, `endDate`, `current` | `start_date`, `end_date` | `startDate`, `endDate` on `EmployeeRole` |
| Location | `location` (string) | `geoPositionLocation.displayLocationName`, `locationName`, `location{countryCode, regionCode}` | `location` | `location` | — | — |
| Narrative | `summary`, `highlights[]` | `description` (rich text) | `descriptions` | `description` | — | `responsibilities` (on `Occupation`) |
| Extras | `url`, `description` (of the company) | `memberRichContents[]` | `workRelationshipTypeCode` (_"an employee, a contractor, a volunteer, an extern, and intern"_), `jobCategories[]`, `jobLevels[]`, sub-`organization` for department | — | — | `baseSalary`, `salaryCurrency` |

**The structural outlier is HR Open**, and it is worth pausing on. Every other standard models a flat
list of jobs. HR Open models **one employer holding many positions**: `EmployerHistoryType` has
exactly two properties — `organization` (_"The specific organization to which the person held
positions or performed work"_) and `positionHistories` (_"The set of positions that the person held
at the organization"_). Two promotions at the same company are one employer record with three
positions, not three jobs.

It is also the only one that records the **nature** of the relationship (`workRelationshipTypeCode`
— employee / contractor / volunteer / extern / intern) rather than making a contract role look
identical to a permanent one.

Sources: [JSON Resume schema](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json) ·
[LinkedIn Position Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/position) ·
[HR Open EmployerHistoryType](https://www.hropentech.org/4.6/common/json-2020-12/profile/EmployerHistoryType.json) ·
[HR Open BaseHistoryType](https://www.hropentech.org/4.6/common/json-2020-12/profile/BaseHistoryType.json) ·
[SmartRecruiters Candidate](https://developers.smartrecruiters.com/reference/candidatesget-1) ·
[Greenhouse Harvest](https://developers.greenhouse.io/harvest.html) ·
[schema.org EmployeeRole](https://schema.org/EmployeeRole)

### 1.2 An education entry

| | JSON Resume | LinkedIn (`Education`) | HR Open (`EducationAttendanceType`) | SmartRecruiters | Greenhouse |
|---|---|---|---|---|---|
| School | `institution` | `organization` (URN) + `schoolName` (free text); `school` is marked **_"Deprecated. Please use `organization`"_** | `institution` → `OrganizationType`, plus separate `department` → `OrganizationType` | `institution` | `school_name` |
| Qualification | `studyType` — _"e.g. Bachelor"_ | `degreeName` | `educationDegrees[]` — an **array** of `{name, date, specializations, score, academicHonors, degreeGrantedStatus, iscedEducationLevelCode}` | `degree` | `degree` |
| Subject | `area` — _"e.g. Arts"_ | `fieldsOfStudy[].fieldOfStudyName` | `specializations` (majors/minors) inside each degree; `programs` list | `major` | `discipline` |
| Result | `score` — _"grade point average, e.g. 3.67/4.0"_ | `grade.grade` (localized string) | `score` + `academicHonors` per degree | — | — |
| Dates | `startDate`, `endDate` | `startMonthYear`, `endMonthYear` — _"Does not support 'day' and 'month' field"_ (**year only**) | `start`, `end`, `current`, plus `otherAttendancePeriods[]` for interrupted study | `startDate`, `endDate`, `current` | `start_date`, `end_date` |
| Extras | `courses[]`, `url` | `activities`, `notes`, `program` (URN), `memberRichContents[]` | `educationLevelCodes[]`, `currentlyAttendingIndicator`, `goodStandingIndicator`, `degreeGrantedStatus` | `description`, `location` | — |

Two things only HR Open does: **many degrees inside one attendance** (you attended one university and
came out with a BSc then an MSc — one record), and **`otherAttendancePeriods`** for the person who
left and came back.

**Greenhouse is the only one with controlled vocabularies**: `GET List Degrees`, `GET List
Disciplines`, `GET List Schools` are real endpoints. Everyone else lets the user type anything.

### 1.3 A certification

| | JSON Resume | LinkedIn | HR Open (`CertificationType`) | schema.org (`EducationalOccupationalCredential`) | Open Badges 3.0 |
|---|---|---|---|---|---|
| Name | `name` — _"e.g. Certified Kubernetes Administrator"_ | `name` | `name` | `name` (from `CreativeWork`) | `Achievement.name` |
| Issuer | `issuer` — _"e.g. CNCF"_ (free string) | `authority` (free text) **and** `company` (URN) | `issuingAuthority` → `OrganizationType`; description: _"The organization that issued the certificate"_ | `recognizedBy` → `Organization` | `Profile` (the issuer) |
| ID | — | `licenseNumber` | `id` → _"A unique identifier to the certificate as defined by the issuing authority"_ | — | credential `id` |
| Validity | `date` (single) | `startMonthYear`, `endMonthYear` | `effectiveTimePeriod` (`validFrom`/`validTo`), plus **`issued`** (_"The most recent issue date"_) and **`firstIssued`** (_"The original issue date... important to know how long the certificate has been held"_) | `validFor` (Duration), `validIn` (AdministrativeArea), `expires`, `datePublished` | `awardedDate`, `validFrom`, `validUntil`, `credentialStatus` |
| Status | — | — | `status` — _"open string, common status include active, expired, pending, suspended"_ | — | `credentialStatus` (revocation) |
| Type | — | — | `type` → `EntityType` | `credentialCategory` — _"'degree', 'certificate', 'badge', or more specific term"_ | `Achievement.type` |

HR Open's `issued` / `firstIssued` split is the sharpest small idea in this whole document: a renewed
PMP certification held since 2011 is materially different from one first issued last month, and only
HR Open can say so. HR Open also **separates licences from certifications** — `LicenseType` is a
distinct schema, described as _"Authoritative permission to hold a certain status or to do certain
things, e.g. to practise some trade or profession."_

### 1.4 A skill

| Standard | How it is modelled |
|---|---|
| **JSON Resume** | `{name, level, keywords[]}`. `level` is a free string, example given: _"e.g. Master"_. No scale. |
| **LinkedIn** | `{id, name}`. **That is the entire object** — LinkedIn's own Skill edit API accepts only a localizable `name`. There is no proficiency field. (Endorsement counts exist in the product, not in this schema.) |
| **HR Open (`PersonCompetencyType`)** | The richest by far: `competencyIds[]`, `taxonomyIds[]` (_"The identifier for categorization of competencies in an HR context"_), `competencyName`, `description`, `proficiencyLevel` (a `BaseScoreType` — _"expressed as a score, a point scale, or a mark among range of values"_), `lastUsedDate`, `experienceMeasure` (_"The duration of experience... asserted or claimed by a candidate as evidence of a competency"_), `interestLevel`, `competencyDimensions[]`, `competencyEvidence`, `attachmentReferences[]`. Its own description: _"a competency... assessed or asserted at specified level of proficiency."_ |
| **HR Open TCP (`SkillType`)** | The résumé-facing simplification: `name`, `yearsOfExperience`, `description`, `definitionReference`, `schemeReference`, `endorsers[]`, `keywords[]`, `lastUsedDate`, `interestLevel`, `comments[]`, `verifications[]`. |
| **schema.org** | `skills` on `Occupation` / `knowsAbout` on `Person`, typed `DefinedTerm or Text`. Definition: _"A statement of knowledge, skill, ability, task or any other assertion expressing a competency that is either claimed by a person, an organization or desired or required to fulfil a role."_ No level. |
| **ELM** | No "skill" on a person. Skills appear as `LearningOutcome` attached to a `LearningAchievementSpecification` — i.e. a skill exists because a *credential* certifies it. |
| **ESCO** | Not a record format — the *vocabulary*. 3,039 occupations and 13,939 skills, 28 languages, v1.2.1 (10 Dec 2025), free portal + API. This is what `taxonomyIds` / `schemeReference` would point at. |

Note the pattern: **`lastUsedDate` appears in both HR Open skill models and nowhere else.** A skill
last used in 2014 and a skill used yesterday are the same object in every other standard.

Sources: [HR Open PersonCompetencyType](https://www.hropentech.org/4.6/common/json-2020-12/competency/PersonCompetencyType.json) ·
[HR Open TCP SkillType](https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/SkillType.json) ·
[LinkedIn Skills edit API](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-edit-api/skills) ·
[schema.org Occupation](https://schema.org/Occupation) · [ESCO](https://esco.ec.europa.eu/en/about-esco/what-esco)

### 1.5 A language

| Standard | Shape | Scale |
|---|---|---|
| **JSON Resume** | `{language, fluency}` | Free string. Schema example: _"e.g. Fluent, Beginner"_. |
| **LinkedIn** | `{id, name, proficiency}` | A real enum: `ELEMENTARY`, `LIMITED_WORKING`, `PROFESSIONAL_WORKING`, `FULL_PROFESSIONAL`, `NATIVE_OR_BILINGUAL`. Five values, one dimension. |
| **Europass** | Five separate skills, self-assessed | Splits into _"listening, reading, spoken interaction, spoken production and writing skills"_ against the **CEFR**. Stored in the Europass profile, shareable as a table. |
| **HR Open** | **No language-skills section exists.** | `PersonProfileInclusion` has `languageCode` (the language *of the profile document*); `ResumePersonBaseType` has only `primaryLanguage`. The `LanguageCodeList` codelist is IETF RFC 4646/4647 language tags — **no CEFR levels in it**. Language ability is meant to be recorded as a competency with a `proficiencyLevel` score. |
| **schema.org** | `knowsLanguage`, typed `Language or Text` | None. |
| **ELM** | `primaryLanguage`, `defaultLanguage`, `dc:language` | **No CEFR, no proficiency representation in the ontology at all** — despite being an EU model. |

This is the biggest surprise in the survey: two of the most serious enterprise models (HR Open, ELM)
have **no first-class concept of "languages I speak"**, and the one that does it properly (Europass)
is a consumer product, not a machine-readable spec.

Sources: [LinkedIn Language Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/language) ·
[Europass self-assessment](https://europass.europa.eu/en/how-self-assess-your-language-skills) ·
[HR Open PersonProfileInclusion](https://www.hropentech.org/4.6/common/json-2020-12/profile/PersonProfileInclusion.json) ·
[HR Open LanguageCodeList](https://www.hropentech.org/4.6/common/json-2020-12/codelist/LanguageCodeList.json)

### 1.6 What a whole career record contains

Two "complete profile" definitions worth having side by side.

**HR Open `PersonProfileInclusion`** (the general career profile):
`profileName`, `languageCode`, `education[]`, `employment[]`, `militaryService[]`, `licenses[]`,
`certifications[]`, `patents[]`, `publications[]`, `qualifications[]` (_"The competencies of the
person"_), `affiliations[]` (_"The organizations with which the person is affiliated"_),
`securityCredentials[]`, `references[]`, `attachments[]`.

**HR Open `TrustedCareerProfileType`** — described as _"Trusted Career Profile (Learning and
Employment Record Resume Standard)"_ — the newer, résumé-facing one:
`type`, `narratives` (_"Experiences, Aspirations, Interests (or any free form text elements)"_),
`job`, `certifications[]`, `person`, `educationAndLearnings[]`, `employmentHistories[]`,
`licenses[]`, `skills[]`, `otherSections[]` (_"Other sections on a resume or career profile. Each
section is defined with a type and can have a title given by the person"_), `employmentPreferences[]`,
`positionPreferences[]`, `communication`, `attachments[]`.

`otherSections` is the escape hatch every CV eventually needs, made explicit and typed.

**JSON Resume's whole document:** `basics`, `work`, `volunteer`, `education`, `awards`,
`certificates`, `publications`, `skills`, `languages`, `interests`, `references`, `projects`, `meta`.

---

## 2. Where they agree, where they disagree — the decision list

### 2.1 Agreed by everyone (treat as settled)

These appear in essentially every standard surveyed. Building them is not a design choice.

- A **work entry** = employer + title + start + end + free-text narrative + location.
- An **education entry** = institution + qualification + subject + start + end.
- A **certification** = name + issuer + a date.
- **Open-endedness is the normal case**: every standard has a way to say "still there" — an omitted
  end date (JSON Resume, LinkedIn: _"Missing value means the position is current"_), a `current`
  boolean (HR Open, SmartRecruiters), or both.
- **Some date imprecision is mandatory**: JSON Resume, HR Open, and SmartRecruiters all *explicitly*
  accept year-only dates. LinkedIn goes further and makes education year-only by construction.
- **Free-text narrative always survives.** Every single standard keeps an unstructured description
  field alongside the structured ones. Nobody believed structure could carry everything.
- **Attachments/evidence hang off the fact**, not off the person: HR Open (`attachmentReferences` on
  history, certification, competency), Greenhouse and Lever (résumé files), TCP (`attachments`).

### 2.2 The five real disagreements — these are the owner's decisions

**Decision 1 — Is an employer a string, or a thing?**
· *String* (JSON Resume `name`, SmartRecruiters `company`, Greenhouse `company_name`): trivial to
capture, nothing to maintain, and "Acme Ltd" / "ACME" / "Acme Limited" are three employers forever.
· *Entity* (HR Open `OrganizationType`, schema.org `Organization`, ELM `Organisation`): the record
can answer "how long at this company across three roles", survives a rename, but you now own an
organisation directory and the matching problem that comes with it.
· *Both* (LinkedIn): `company` URN **and** `companyName` free text, both optional — the entity when
you can resolve it, the string when you can't. This is the only design that survives contact with a
real CV, and it is what LinkedIn actually ships.

**Decision 2 — Is a job a flat entry, or a position inside an employer?**
· *Flat list* (everyone except HR Open): a promotion is a new job. Simple; loses tenure.
· *Employer → positions* (HR Open `EmployerHistoryType`): correct for careers with internal
progression — which is most senior careers, and specifically IT-PM careers — at the cost of a
two-level UI and a harder import from any flat CV.

**Decision 3 — Controlled vocabulary, or free text?**
· *Free text everywhere* (JSON Resume, LinkedIn's user-entered fields, SmartRecruiters): captures
what the person actually wrote.
· *Controlled lists* (Greenhouse: `List Degrees`/`List Disciplines`/`List Schools`; HR Open:
`taxonomyIds`, `iscedEducationLevelCode`, `IscedCodeList`; ELM: `ISCEDFCode`, `EQFLevel`/`NQFLevel`;
ESCO as the skill dictionary): makes cross-person comparison and matching possible, at the cost of
forcing every fact through a list that will not contain the user's actual degree.
· No standard splits the difference well. HR Open comes closest by keeping `competencyName` (free
text) *and* `competencyIds`/`taxonomyIds` (the code) on the same object.

**Decision 4 — Does a skill carry a level, and on what scale?**
· *No level* (LinkedIn — skills are name-only; schema.org). Honest, since self-assessed levels are
noise.
· *Free-text level* (JSON Resume `level`, _"e.g. Master"_). Looks structured, isn't.
· *Scored level + evidence* (HR Open `proficiencyLevel` as a score/point-scale, plus
`competencyEvidence`, `lastUsedDate`, `experienceMeasure`). Real, but demands the person supply
things they mostly can't.

**Decision 5 — Is the record a document, or a set of claims?**
· *Document* (JSON Resume, Europass CV, every ATS): one blob, replaced wholesale on edit.
· *Claims with independent provenance* (HR Open TCP, ELM, Open Badges 3.0, W3C VC): each fact can
carry its own verification and its own validity window. This is the only shape that supports a
record accumulating over ten years — and it is also the shape that makes every screen harder to
build. §6 has the detail.

---

## 3. How each standard models an organisation

This was flagged as our sharpest open question. The field has converged more than expected: **the
mainstream answer is one organisation type, with the *role* carried by the property that points at
it, not by the organisation's own type.**

| Standard | Employer, school, and issuer are… | How the role is expressed |
|---|---|---|
| **HR Open** | **One type.** `OrganizationType` — _"Information to identify and reference a specific legal organization."_ It carries `taxIds`, `legalIds`, `formerTaxIds`, `formerLegalIds`, `industryIdentifiers`, `contacts`, `keyStakeholders`. Nothing in it is employer-specific or school-specific. | By where it sits: `EmployerHistoryType.organization`, `EducationAttendanceType.institution` (and a second one for `department`), `CertificationType.issuingAuthority`, `VerifyingOrganizationType.verifyingOrganization`. |
| **ELM** | **One class.** `elm:Organisation` — _"A legal person / registered organisation."_ Properties: `eidasLegalIdentifier`, `vatIdentifier`, `taxIdentifier`, `logo`. | By property: `awardedBy`, `providedBy`, `accreditingAgent`, `Accreditation.organisation`. `AwardingBody` exists as a separate class for the awarding relationship specifically. |
| **schema.org** | **Split, but shallowly.** `Organization` is the base; `EducationalOrganization` is a subtype (of both `Organization` **and** `CivicStructure`), with its own subtypes `CollegeOrUniversity`, `School`, `HighSchool`, `MiddleSchool`, `ElementarySchool`, `Preschool`. There is **no** "certificate issuer" type — `recognizedBy` just points at `Organization`. | By property (`worksFor`, `alumniOf`, `affiliation`, `memberOf`, `recognizedBy`) **and** by `Role` objects that wrap the relationship (§4). |
| **CTDL** (Credential Engine) | **One superclass, role subclasses.** Organisations sit under an `Agent` superclass; `CredentialOrganization` and `QACredentialOrganization` are the named subclasses. Identified by `ceterms:ctid` — literally `ce-` + a UUIDv4 — plus `ceterms:fein`, `ceterms:opeID`, `ceterms:ipedsID`. | By relationship property: `ceterms:offers` (offerer/owner), `ceterms:accreditedBy` (quality assurer). CTDL's handbook explicitly shows **one organisation holding several roles at once**. |
| **LinkedIn** | **One entity, two representations.** `urn:li:organization:{id}` is used for employers (`Position.company`), schools (`Education.organization` — with the older school-specific `school` URN explicitly _"Deprecated. Please use `organization`"_), and certificate issuers (`Certification.company`). | LinkedIn *collapsed* its separate school type into the general organisation type. That is a published design reversal in exactly our direction. |
| **JSON Resume / SmartRecruiters / Greenhouse / Lever** | **Not an entity at all.** A string on the record: `name`/`institution`/`issuer`, `company`/`institution`, `company_name`/`school_name`. | N/A. |

**The published reasoning, such as it is.** None of these bodies publishes an essay defending the
choice, but two artefacts amount to evidence:

1. **LinkedIn deprecated its school-specific URN in favour of the generic organisation URN.** They
   ran the two-types design at planetary scale and merged them. That is the strongest empirical
   signal available on this question.
2. **CTDL's own handbook demonstrates one organisation being both offerer and accredited party**
   simultaneously — the case that breaks a type-per-role design, because the type would have to be
   two things at once.

The dissent is schema.org's `EducationalOrganization`, and its motive is visible: schema.org is a
*search* vocabulary. A university needs to be findable as a university on the open web. That is a
publishing concern, not a career-record concern.

Sources: [HR Open OrganizationType](https://www.hropentech.org/4.6/common/json-2020-12/organization/OrganizationType.json) ·
[ELM ontology (ELM.ttl)](https://raw.githubusercontent.com/european-commission-empl/European-Learning-Model/master/rdf/ontology/ELM.ttl) ·
[schema.org EducationalOrganization](https://schema.org/EducationalOrganization) ·
[CTDL handbook](https://credreg.net/ctdl/handbook) ·
[LinkedIn Education Fields](https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile/education)

---

## 4. How each standard models a date range, and what it does about imprecision

Real CVs give "2013–2015", "Oct 2019 – June 2023", "July 2025 – Present". Here is what each standard
can and cannot represent.

| Standard | Date type | Year-only? | Open end? | Records *that* it's imprecise? |
|---|---|---|---|---|
| **HR Open** | A whole family of typed values: `YearType`, `YearMonthType`, `MonthType`, `DateType`, `DateTimeType` — and a union, `FormattedDateTimeType`, described as _"This is formatted representation of a date, which may be specified as a date, date/time, year, or year/month"_ (an `anyOf` over those four). | **Yes, as a distinct type.** `YearMonthType` is `{"type":"string","hropenFormat":"yearMonth","pattern":"^([12]\\d{3}-(0[1-9]|1[0-2]))$"}` — a year-month is its own type, not a truncated date. | **Yes, as a distinct type.** `YearOpenEndPeriodType`, `YearMonthOpenEndPeriodType`, `DateOpenEndPeriodType`, `DateTimeOpenEndPeriodType`, `OpenEndPeriodType`. `YearMonthOpenEndPeriodType` is documented as: _"Single period between year/months. The end year/month is optional and should be used in cases where the end of the period is unknown or uncertain."_ Plus a `current` boolean on `BaseHistoryType`. | **Yes — by the type itself.** A value typed `YearType` *is* the statement "we know only the year". |
| **JSON Resume** | One `iso8601` definition, used everywhere: _"Similar to the standard date type, but each section after the year is optional. e.g. 2014-06-29 or 2023-04"_, `pattern: "^([1-2][0-9]{3}-[0-1][0-9]-[0-3][0-9]\|[1-2][0-9]{3}-[0-1][0-9]\|[1-2][0-9]{3})$"` | Yes — the third alternation branch. | Yes — omit `endDate`. | Implicitly, by string length. A consumer must parse to find out. |
| **LinkedIn** | A `Date` object `{month, year}` (and `{year}`), **with per-element-type precision fixed by the schema**: `Position` — _"Does not support 'day' field"_; `Education` — _"Does not support 'day' and 'month' field"_ (year only); `Certification` — month + year. | Yes for education, by construction. | Yes: _"Missing value means the position is current."_ | Not per-record — the *element type* declares its precision globally. A person cannot say "I know the month for this job but not that one". |
| **SmartRecruiters** | A named `When` format: **`YYYY`, `YYYY-MM`, or `YYYY-MM-dd`**, on both education and experience. Plus `current` boolean. | Yes. | Yes, via `current`. | Implicitly, by string length. |
| **Greenhouse** | `start_date` / `end_date`. | Not documented as supported. | Not documented. | No. |
| **ELM (Europass)** | `elm:startDate` and `elm:endDate`, domain `dc:PeriodOfTime`, **`rdfs:range xsd:dateTime`**. Every date property in the ontology — `awardingDate`, `expiryDate`, `reviewDate`, `applicationDeadline`, `dateOfBirth` — is `xsd:dateTime`. **There is not a single `xsd:date` property in ELM.** | **No.** A degree awarded "in 2015" must be given a fabricated instant. | Yes (omit `endDate`). | **No.** The EU's flagship learning model cannot say "we only know the year", and forces false precision on every historical fact. |
| **schema.org** | `startDate` / `endDate` on `Role`/`EmployeeRole`, typed `Date or DateTime`, described as _"in ISO 8601 date format"_. | Only as far as ISO 8601 reduced precision is tolerated by the consumer — the vocabulary itself has no precision marker. | Yes (omit). | No. |

**Is there a standard way to say "we only know the year"?** Yes — two, from outside the CV world:

- **EDTF (Extended Date/Time Format), folded into ISO 8601-2:2019**, maintained by the Library of
  Congress. It encodes imprecision *in the string*: `2016?` = uncertain, `2016~` = approximate,
  `2016%` = both, `20XX` = unspecified digits, `..` = an open or unknown interval end (e.g.
  `[..2016]`, `2015/..`). Levels 0/1/2 of increasing expressiveness.
  _Caveat on sourcing: loc.gov and id.loc.gov both refused automated fetches during this research.
  The syntax above is taken from the UNT EDTF validation service (which states it validates against
  the LoC spec) and the `edtf.js` reference implementation README (which states it "fully implements
  EDTF levels 0, 1, and 2 as specified by ISO 8601-2"). The normative text is at
  [loc.gov/standards/datetime](https://www.loc.gov/standards/datetime/) and should be read directly
  before implementing._
  **Adoption in the career/HR world: zero.** No standard surveyed here uses it.

- **Wikidata/Wikibase's time datatype**, which keeps a **separate `precision` integer** beside the
  timestamp: `9` = year, `10` = month, `11` = day (`8` = decade, `7` = century, `6` = millennium),
  alongside `time`, `calendarmodel`, `timezone`, `before`/`after`. Vagueness beyond that is pushed
  to qualifiers — _sourcing circumstances (P1480)_ carries values like "circa".

So the field offers three distinct architectures for imprecision, all in production somewhere:
**typed values** (HR Open), **encoded-in-the-string** (EDTF), **separate precision field**
(Wikidata). Only the first has any traction in HR.

Sources: [HR Open base types listing](https://www.hropentech.org/4.6/common/json-2020-12/base/) ·
[YearMonthType](https://www.hropentech.org/4.6/common/json-2020-12/base/YearMonthType.json) ·
[FormattedDateTimeType](https://www.hropentech.org/4.6/common/json-2020-12/base/FormattedDateTimeType.json) ·
[YearMonthOpenEndPeriodType](https://www.hropentech.org/4.6/common/json-2020-12/base/YearMonthOpenEndPeriodType.json) ·
[JSON Resume schema](https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json) ·
[SmartRecruiters Candidate](https://developers.smartrecruiters.com/reference/candidatesget-1) ·
[ELM.ttl](https://raw.githubusercontent.com/european-commission-empl/European-Learning-Model/master/rdf/ontology/ELM.ttl) ·
[EDTF (LoC)](https://www.loc.gov/standards/datetime/) ·
[UNT EDTF validator](https://digital2.library.unt.edu/edtf/) ·
[edtf.js](https://github.com/inukshuk/edtf.js) ·
[Wikidata Help:Dates](https://www.wikidata.org/wiki/Help:Dates)

---

## 5. Levels and grades — which scales are real and which are cosmetic

### Language proficiency

| Scale | Shape | Interoperable? |
|---|---|---|
| **CEFR** | Six levels `A1 A2 B1 B2 C1 C2`, in three bands (Basic / Independent / Proficient User). Europass applies it across **five separate skills**: _"listening, reading, spoken interaction, spoken production and writing"_. | **Yes — genuinely.** It is the reference framework across EU education and employment, and the one an EU employer will recognise. _(Sourcing note: the coe.int level tables blocked automated fetch; the five skills and the CEFR attribution are quoted from the Europass page, which I did read.)_ |
| **ILR** | Levels `0`–`5` with `+` designations, applied to speaking, listening, reading, writing, translation, interpretation and intercultural competence. _"The designation 0+, 1+, 2+, etc. will be assigned when proficiency substantially exceeds one skill level and does not fully meet the criteria for the next level."_ | Yes, within US government/defence. Effectively invisible in commercial hiring. |
| **LinkedIn's scale** | `ELEMENTARY`, `LIMITED_WORKING`, `PROFESSIONAL_WORKING`, `FULL_PROFESSIONAL`, `NATIVE_OR_BILINGUAL` — five values, one dimension. | **Not a standard, but the most widely recognised labels in commercial hiring**, because everyone has seen them on a LinkedIn profile. These are the ILR band names in words; the mapping to ILR numerals is conventional, not published by LinkedIn. |
| **JSON Resume `fluency`** | Free string, _"e.g. Fluent, Beginner"_. | **Cosmetic.** Two records are not comparable. |
| **HR Open / ELM** | Nothing. See §1.5. | N/A |

### Degree classification and education level

- **Nothing interoperable exists for degree *classification*** (First / 2:1 / cum laude / GPA). Every
  standard punts to free text: LinkedIn `grade.grade` (a localized string), JSON Resume `score`
  (_"grade point average, e.g. 3.67/4.0"_), HR Open `score` + `academicHonors`. ELM's
  `LearningAssessment.grade` is `xsd:string`.
- **What *is* interoperable is education *level*:** **ISCED** (HR Open `iscedEducationLevelCode` and
  its `IscedCodeList`; ELM `ISCEDFCode` for fields of education) and **EQF/NQF** (ELM
  `Qualification.EQFLevel`, `Qualification.NQFLevel`). These are real, government-maintained, and let
  you compare a Vietnamese diploma with a French one. schema.org's `educationalLevel` is by contrast
  free-form — its own examples are _"'beginner', 'intermediate' or 'advanced'"_.
- ELM has one genuinely clever grading idea worth noting: `ShortenedGrading` with
  `percentageLower` / `percentageEqual` / `percentageHigher` — _"Indicator of how well the student
  was graded when compared to other students"_ — which makes an unfamiliar national grade
  interpretable without mapping it.

### Skill proficiency

**No interoperable scale exists.** HR Open's `proficiencyLevel` is a `BaseScoreType` — _"expressed as
a score, a point scale, or a mark among range of values"_ — i.e. the standard defines a *container*
for a scale and declines to define the scale. LinkedIn declines to record one at all. JSON Resume's
`level` is a free string. Any skill level we invent will be ours alone, and will not travel.

---

## 6. Which standards are built for a record that grows

This is the question our long-term direction turns on, and the field is thin.

**Snapshot documents (the overwhelming majority).** JSON Resume is a document — its only temporal
metadata is `meta.lastModified` and `meta.version` at the *document* level; individual facts have no
history. Greenhouse, SmartRecruiters and Lever store an application-time snapshot; Lever doesn't even
keep structured history, just the résumé file. schema.org describes a thing as it is now. None of
these model who told us, when we learned it, or what an entry replaced.

**The three genuine exceptions:**

**1. Europass Profile — the model closest to our stated direction, and it is a shipping product.**
Europass explicitly separates the stored profile from the generated document: _"You will first have
to create your Europass profile with information on your education, training, work experience and
skills. After you complete your Europass profile, you can create as many CVs as you want with just a
few clicks."_ Plus a "Europass Library" holding the generated CVs. **This is the disposable-CV thesis
already in production at EU scale.** What it does *not* do is model provenance or supersession — the
profile is a mutable store, and editing a fact destroys the old one.

**2. HR Open's Trusted Career Profile (TCP) — "Learning and Employment Record Resume Standard"
(LER-RS).** The only surveyed standard designed so that *individual facts* carry their own trust.
Its `tcp/` folder contains a `Verifiable…Type` for each element:
`VerifiableEmploymentHistoryType`, `VerifiableEducationAttendanceType`, `VerifiableCertificationType`,
`VerifiableLicenseType`, `VerifiableSkillType`, `VerifiableOtherSectionType` — plus a
`Provisional…` variant of each.

The `VerificationType` is a `oneOf` over three genuinely different trust levels, and the descriptions
are unusually candid:
- `org` → `VerifyingOrganizationType` — _"A verification with information from a verifying
  organization. **Note that this is not a Verifiable Credential (VC).**"_ (i.e. "call this employer";
  `VerifyingOrganizationType` is described as _"A reference to an organization that can provide
  verification of a claim (by contacting the organization and/or person identified)"_)
- `ref` → `RefSchemeType` — _"An external reference to a verification. Note that this may or may not
  be a reference to a Verifiable Credential (VC)."_
- `other` → `OtherVerifiableCredentialType` — _"A Verifiable Credential (VC) of any type."_

The whole profile can also be wrapped as a W3C VC: `VerifiableCredentialTrustedCareerProfileType`,
_"Trusted Career Profile (LER-RS) provisional JSON Schema for W3C Verifiable Credential"_, whose
`@context` must begin with `https://www.w3.org/ns/credentials/v2` (or the 2018 v1) and whose `type`
must be `VerifiableCredential` then `TrustedCareerProfileCredential`.

TCP also carries endorsement (`EndorserType`, and `endorsers[]` on `SkillType`) and staleness
(`lastUsedDate` on skills) — both facts *about* a fact rather than the fact itself.

**Caveat the owner should weigh:** every verifiable type in TCP is named `Provisional…` in its
credential form, and the schema files are dated 2026-05 / 2026-06. This is new. Its adoption is
unproven, and I found no public list of implementers.

**3. ELM / Open Badges 3.0 / W3C VC — provenance done properly, for credentials only.**
ELM's core insight is that an achievement is the *output of a process*: `AwardingProcess` — _"The
process of an organisation making a Claim to person based on a Specification"_ — with `used`,
`awards`, `awardingDate`, `educationalSystemNote`. The person's side is `Claim` (_"A claim made by an
issuer"_) with `specifiedBy` and `awardedBy`; `Person` holds `hasCredential` and `hasClaim`.
Validity and revocation come from the VC layer (`cred:validFrom`, `cred:validUntil`,
`cred:issuanceDate`, `cred:expirationDate`), with `Evidence` and `VerificationCheck` classes
alongside. Open Badges 3.0 does the same job in the same VC frame (`AchievementCredential`,
`Achievement`, `AchievementSubject`, `Profile` for the issuer, `awardedDate`, `validFrom`,
`validUntil`, `credentialStatus` for revocation, `Alignment` to a competency framework).

**What nobody models, anywhere.** Across every standard read for this document, **not one models
supersession** — "this fact replaced that fact", or "we believed X until date D". Validity windows
(`validFrom`/`validUntil`, `effectiveTimePeriod`) say when a *credential* was valid in the world;
they say nothing about when *our record* believed something. HR Open's `firstIssued` vs `issued` on a
certification is the closest anything comes, and it is about renewals, not corrections.

Likewise **nobody models "when we learned it"** as distinct from "when it happened". If our record is
to accumulate over a decade and stay honest about where each fact came from, that part is
unprecedented in these standards and we would be designing it ourselves.

Sources: [Europass CV creation](https://europass.europa.eu/en/create-europass-cv) ·
[HR Open TrustedCareerProfileType](https://www.hropentech.org/4.6/recruiting/json-2020-12/TrustedCareerProfileType.json) ·
[TCP folder listing](https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/) ·
[VerificationType](https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/VerificationType.json) ·
[VerifyingOrganizationType](https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/VerifyingOrganizationType.json) ·
[VerifiableCredentialTrustedCareerProfileType](https://www.hropentech.org/4.6/recruiting/json-2020-12/VerifiableCredentialTrustedCareerProfileType.json) ·
[ELM.ttl](https://raw.githubusercontent.com/european-commission-empl/European-Learning-Model/master/rdf/ontology/ELM.ttl) ·
[Open Badges 3.0](https://www.imsglobal.org/spec/ob/v3p0/)

---

## 7. Access and licensing notes (relevant if we ever want to import or export)

- **LinkedIn is closed for import.** Only Lite Profile (name, photo) is open to all developers.
  Everything a career record needs is Partner-Program-gated: _"The use of this API is restricted to
  those developers approved by LinkedIn and subject to applicable data restrictions in their
  agreements."_ And on storage: _"You may only store data returned from the Profile API for the
  authenticated members with their permission... You may never store data returned from the Profile
  API for members other than the authenticated member."_ Treat LinkedIn as a **design reference**,
  not a data source.
- **HR Open** schemas are free to download but require agreeing to the HR Open IP Agreement and
  registering a free Community membership account; work-in-progress repositories are members-only.
  The published 4.6 JSON Schemas are directly fetchable at `hropentech.org/4.6/…` without auth.
- **ESCO** is free (portal + API), v1.2.1, 10 Dec 2025.
- **schema.org, JSON Resume, ELM (EUPL 1.2), Open Badges 3.0, CTDL** are all openly published.

---

## 8. Sources

Every URL below was fetched directly during this research unless marked otherwise.

**JSON Resume**
- Schema: https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json
- Repo (archived 12 Jun 2026): https://github.com/jsonresume/resume-schema

**Europass / ELM / ESCO**
- ELM ontology (Turtle): https://raw.githubusercontent.com/european-commission-empl/European-Learning-Model/master/rdf/ontology/ELM.ttl
- ELM repo (archived 14 Feb 2024): https://github.com/european-commission-empl/European-Learning-Model
- ELM Browser (v3.3.1): https://europa.eu/europass/elm-browser/
- Europass CV creation / profile-vs-CV: https://europass.europa.eu/en/create-europass-cv
- Europass language self-assessment: https://europass.europa.eu/en/how-self-assess-your-language-skills
- ESCO: https://esco.ec.europa.eu/en/about-esco/what-esco

**HR Open Standards 4.6**
- Consortium: https://hropenstandards.org/ · Downloads: https://hropenstandards.org/news/download-the-standards
- Recruiting schemas index: https://www.hropentech.org/4.6/recruiting/json-2020-12/
- `CandidateType`: https://www.hropentech.org/4.6/recruiting/json-2020-12/CandidateType.json
- `TrustedCareerProfileType`: https://www.hropentech.org/4.6/recruiting/json-2020-12/TrustedCareerProfileType.json
- `VerifiableCredentialTrustedCareerProfileType`: https://www.hropentech.org/4.6/recruiting/json-2020-12/VerifiableCredentialTrustedCareerProfileType.json
- TCP types: https://www.hropentech.org/4.6/recruiting/json-2020-12/tcp/ (`VerificationType.json`, `VerifyingOrganizationType.json`, `SkillType.json`, `ResumePersonBaseType.json`)
- Profile types: https://www.hropentech.org/4.6/common/json-2020-12/profile/ (`PersonProfileInclusion.json`, `PersonProfileType.json`, `BaseHistoryType.json`, `EducationAttendanceType.json`, `EmployerHistoryType.json`, `CertificationType.json`)
- Base/date types: https://www.hropentech.org/4.6/common/json-2020-12/base/ (`FormattedDateTimeType.json`, `YearMonthType.json`, `YearMonthOpenEndPeriodType.json`, `EffectiveTimePeriodType.json`)
- Organisation: https://www.hropentech.org/4.6/common/json-2020-12/organization/OrganizationType.json
- Competency: https://www.hropentech.org/4.6/common/json-2020-12/competency/ (`PersonCompetencyType.json`, `CompetencyType.json`)
- Codelists: https://www.hropentech.org/4.6/common/json-2020-12/codelist/ (`LanguageCodeList.json`, `IscedCodeList.json`)

**schema.org**
- https://schema.org/Person · https://schema.org/Role · https://schema.org/EmployeeRole ·
  https://schema.org/EducationalOccupationalCredential · https://schema.org/Occupation ·
  https://schema.org/OccupationalExperienceRequirements · https://schema.org/EducationalOrganization

**LinkedIn**
- Profile Fields index: https://learn.microsoft.com/en-us/linkedin/shared/references/v2/profile
- Profile API + access restrictions: https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api
- Reference schemas: `.../references/v2/profile/position`, `/education`, `/language`, `/lite-profile`
- Edit APIs: `.../integrations/people/profile-edit-api/positions`, `/educations`, `/certifications`, `/skills`, `/languages`

**ATS**
- Greenhouse Harvest: https://developers.greenhouse.io/harvest.html
- SmartRecruiters Candidate: https://developers.smartrecruiters.com/reference/candidatesget-1
- Lever: https://hire.lever.co/developer/documentation

**Credential infrastructure**
- CTDL handbook: https://credreg.net/ctdl/handbook
- Open Badges 3.0: https://www.imsglobal.org/spec/ob/v3p0/

**Dates**
- EDTF / ISO 8601-2 (normative home; **blocked automated fetch — read via secondary implementations,
  verify before implementing**): https://www.loc.gov/standards/datetime/
- UNT EDTF validation service: https://digital2.library.unt.edu/edtf/
- `edtf.js` reference implementation: https://github.com/inukshuk/edtf.js
- Wikidata time datatype: https://www.wikidata.org/wiki/Help:Dates

**Language scales**
- ILR scale: https://www.govtilr.org/Skills/ILRscale1.htm
- CEFR (coe.int level tables **blocked automated fetch**; level structure cross-read from the
  Europass page above and the Cedefop self-assessment grid PDF):
  https://www.coe.int/en/web/common-european-framework-reference-languages/table-2-cefr-3.3-common-reference-levels-self-assessment-grid ·
  https://www.cedefop.europa.eu/files/europass_-_european_language_levels_-_self_assessment_grid.pdf

---

## Appendix — pages that refused automated fetch

Recorded so a future session doesn't repeat the work: `loc.gov/standards/datetime/*` (403),
`id.loc.gov/datatypes/edtf/*` (403), `coe.int/…/common-european-framework-*` (403),
`github.com/HROpenStandards` (404 — the org does not exist publicly; HR Open's schemas are served
from `hropentech.org`, not GitHub), `learn.microsoft.com/…/v2/profile/profile-fields` (404 — the
correct path is `/references/v2/profile`), `docs.merge.dev/ats/candidates` (404 — Merge's unified ATS
candidate model was not reachable and is **not** covered in this document).
