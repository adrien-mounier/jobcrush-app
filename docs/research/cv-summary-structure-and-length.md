# The CV summary: how long it may be, what shape it takes, and whether anyone reads it

_Deep-sources half of the research for [#152](https://github.com/adrien-mounier/jobcrush-app/issues/152),
under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127). Serves
[#143](https://github.com/adrien-mounier/jobcrush-app/issues/143), which makes the decision — **this
document decides nothing**. Written 2026-08-06; every source accessed that day._

_A `/last30days` companion covers recent movement. This half covers peer-reviewed studies read from the
publisher's own file, recruiter eye-tracking experiments, CV-parser and ATS vendors' own published
schemas, national and government career services, and the dominant job board in each market we serve._

**What set this off.** `apps/api/prompts/preview-tailor.md` rule 10 says *"Summary ≤ 55 words"*.
[ADR-0002](../adr/0002-how-a-structured-fact-reaches-the-cv.md) repeats it (*"The summary is capped at 55
words"*) while quoting the prompt. `docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md` §3 says
**60–80 words, 3–4 lines** and a **three-part** shape, from a source method of *"Gemini CLI web research
across four targeted queries"*. Nothing in the repo derives any of it.

---

## How to read the evidence grades

Same scheme as [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md),
because this document extends it and the two must be readable together.

| Grade | Means |
|---|---|
| **A** | A vendor's own published machine-readable schema, or a standards body. Verifiable, not opinion. |
| **B** | Peer-reviewed study or review with a stated sample and method. |
| **C** | Vendor analytics or vendor guidance with a stated sample or a stated author, but no published method — **and a commercial interest in the answer**. |
| **D** | **No good evidence found.** Said so, never filled in with a plausible number. |

🚨 **A fourth category exists in this field and it is the one that matters here: the uncited assertion
repeated until it sounds like a rule.** Every word-count and line-count in circulation is one of these.
They are marked **UNCITED** below and they are not graded, because there is nothing to grade.

---

## Bottom line

**1. 🚨 There is no sourced basis for any word or line cap on a CV summary. None. Not 55, not 60–80, not
3–4 lines.** The peer-reviewed literature's *only* length finding about a CV is **"do not exceed two
pages"**, supported by ten separate studies (Risavy 2017, Table 1). It says nothing whatever about the
summary's length. The single measurement that exists anywhere is a **vendor's**: 394 self-selected
"successful" résumés on Kickresume averaged **57 words** of summary, with a range of **7 to 289**. Our 55
is not derived from that — it predates our knowing it — and 57 is a **mean of a wildly dispersed sample**,
not a cap. **The honest statement is: 55 is convention, and so is every rival number.**

**2. The three-part *identity / specialisation / quantified value* shape is a widely-copied assertion, and
the one experiment that comes closest to testing it produced a finding that undercuts the "summary"
framing entirely.** Bright & Hutton (2000), 62 managers and HR consultants rating genuine résumés, found
that including **competency statements raised suitability ratings, ranking and interview decisions** —
and that **the *location* of those statements did not influence ratings**. If that holds, the value is in
*having* two-to-six concrete competency claims somewhere on the page, not in *putting them at the top*.

**3. 🚨 The best evidence on whether the summary is read says it carries no decision signal.** Pina et al.
(2023) put eye-trackers on **221 recruiters** across **2,043 complete résumé screenings** and split every
résumé into eight areas of interest — the first being **Introduction**, which is the summary. Time on
**Experience** predicted whether a résumé advanced. Time on the introduction did not: *"no insights are
gained with respect to the AOI sections for skills, projects, **introduction**, and address."* The authors
themselves add the caveat we must keep: that is **not** proof the section is unimportant, only that gaze
on it did not separate the résumés that advanced from those that did not.

**4. The two most-quoted eye-tracking numbers in the industry come from a job board, not a lab, and the
peer-reviewed figure is 5 to 30 times larger.** The 6-second (2012) and 7.4-second (2018) figures are
**TheLadders'**, a company selling résumé-writing services; the 2018 study PDF now 403s and neither
release ever disclosed a résumé count. The 2012 release did disclose **30 recruiters over 10 weeks** —
and its list of the six things recruiters look at (name, current title/company, previous title/company,
both sets of dates, education) **does not contain the summary**. Against that, Pina et al. cite
**Schramm & Dortch (1991)**: screening lasts *"on average between thirty seconds and three minutes"*.
**State the disagreement; do not average it.**

**5. There is real outcome evidence that a concrete achievement beats a capability claim — and it is not
about the summary section.** Thoms et al. (1999) found résumés carrying accomplishment statements
(their own example: *"not one customer complaint in two years"*) were rated more favourably than those
without. Knouse (1994) found self-descriptive statements that clarify credentials **in a reasonable and
not overly exaggerated manner** help, while Knouse et al. (1988) found ingratiation and exaggerated trait
claims **hurt**. ⭐ **This is the sourced version of what #143 wants to mandate** — and it points at
*"Proven ability to…"* and *"Expertise in…"* as the exact failure mode the literature already names.

**6. The summary is inert to every ATS we can read, and *visible* to every parser we can read. Those are
two different sentences and the industry conflates them.** Textkernel models a *"Summary/Ambitions
Section"*; Affinda returns **`summary` and `objective`** as separate fields. But **Greenhouse, Lever,
iCIMS and SAP SuccessFactors store no summary field at all**, and Greenhouse's keyword search runs over
*"the full text of resumes and internal notes"* — the summary is text like any other text, with no
documented weighting. ⚠️ **And a discrepancy with our own prior research:** SEEK's published
application-export schema — the pipe into HK, SG and AU employers — documents employment history,
education, certifications, qualifications and contact details, and **no free-text summary field**.

**7. 🚨 The ban on "I" is sourced, dated, and says something different from what we implemented — and the
dominant job board in our largest market tells candidates the opposite.** The résumé literature's
accumulated advice is to *"write in the third person (`he`, `she`, `they`) as opposed to the first person
(`I`, `we`)"*, cited to nine studies, the newest from 2014 and most from the 1980s. **That is third
person, not the no-pronoun implied-subject style our prompt actually enforces** — nobody tested ours.
Meanwhile **SEEK (Australia)** instructs: *"Write your resumé summary in the first person ('I led a team
of five')… In the rest of your resumé, omit pronouns altogether."* One of our six corpus CVs is doing
what SEEK tells Australians to do.

**8. 🚨 "Career objectives are replaced by the professional summary" is a vendor claim, and the
peer-reviewed synthesis says close to the opposite.** Risavy (2017): *"the best available advice for
resume writers is to avoid a personal opening and to instead include an objective or a summary of
qualifications."* Harcourt et al. (1991), **212 campus recruiters**, preferred a **career objective** over
a job objective or a combination. The "replaced by" claim traces to résumé-writing firms (TopResume,
Randstad, iHire) and cites nothing. **Vietnam is a live counter-example** — see finding 9.

**9. Market variation is real, and it is not where the brief expected it. Three of our four markets are
one convention; Vietnam is a different document.** Hong Kong, Singapore and Australia are served by
**one company** — SEEK owns JobsDB and JobStreet — whose three country sites give **three different
numbers** (1–3 sentences · 2–4 lines · 3–5 sentences, and 2–3 sentences on another page of the same
site). ⭐ **That is editorial variance inside one publisher, not market convention, and it is the
strongest single argument that no number is load-bearing.** Vietnam genuinely diverges: the CV opens with
**giới thiệu bản thân *and* mục tiêu nghề nghiệp** — self-introduction *plus* career objective, the
objective split into short-term (6 months to 1–3 years) and long-term (>3 years). **Vietnam did not get
the memo that the objective is dead, because there was never anything in the memo.**

**10. What this means for the 55-word cap, stated plainly.** The number is unsourced, but it is **not
idle** — [ADR-0002](../adr/0002-how-a-structured-fact-reaches-the-cv.md)'s open item uses the cap as the
forcing function that stops promoted facts turning the summary into a checklist. **Deleting the cap
without replacing that pressure re-opens a problem the ADR already identified.** The research finding is
that the cap is a **product choice about density**, and must stop being written down as if it were a
market rule.

---

## The eight questions

### 1. Length — is there any sourced basis for a word or line cap?

**No. Grade D on the summary specifically; grade B on the whole CV.**

**What the peer-reviewed literature actually says.** Risavy (2017) is a synthesis of the empirical résumé
research read in full from the publisher's own PDF. Its §3 is titled *"How Long Should the Resume Be?"*
and concludes:

> *"The advice regarding not exceeding two pages for resumes has been a consistent finding in the
> literature over time (e.g., Feild & Holley, 1976; Harcourt & Krizan, 1989; Harcourt et al., 1991; Horn,
> 1988; Hornsby & Smith, 1995; Schramm & Dortch, 1991; Thoms et al., 1999)."*

and its Table 1 (*"Historical advice for resume and cover letter writing"*) has exactly one entry under
**Length**: *"ensure that your resume does not exceed two pages"*, against ten citations. 🚨 **There is no
row for the summary's length, and no word count anywhere in the paper.** Risavy's own list of unanswered
research questions includes *"How long should the resume be?"* and *"Is a full two-page resume more
effective than a one-and-a-half-page resume?"* — the field has not settled **pages**, let alone words.

**The only measurement of a summary's length that exists.** Kickresume, 20 May 2024, analysing **394
résumés** *"submitted by successful job seekers who created their resume at Kickresume, got a job, and
decided to share their resume"*:

- **70%** included a summary;
- the summary averaged **57 words**, ranging **7 to 289**;
- median whole-résumé length **443 words**.

⚠️ **Grade C, and read the sample honestly.** Self-selected, self-reported, on the vendor's own template,
by people who succeeded — with no comparison group of people who did not. It measures **what a form
produced**, the same systematic bias
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
already recorded for every résumé-builder statistic. A **mean of 57 with a range of 7–289** is not
evidence for a **cap** of anything.

**Where 55 comes from: nothing.** It appears in this repo twice and nowhere else that could be traced.
Searching for it returns only résumé-builder blogs, several of which now reason *backwards* from the
Kickresume mean (*"55 words… aligns well with current best practices"*). **The number entered our
codebase before we had the 57-word datum and is not derived from it.**

**Where 60–80 comes from: résumé-builder content, mutually citing.** Enhancv, Jobscan, Kickresume,
QuillBot and a dozen SEO pages give **40–80**, **50–80**, **2–4 sentences**, **3–5 lines**. None cites a
study. Our own `2026-05-03_it-pm-cv-best-practices.md` §3 is one LLM's compression of exactly this layer,
and its header says so.

**The numbers actually published by the market channels our users apply through**, all **UNCITED**:

| Source | Market | Number |
|---|---|---|
| SEEK, *How to write a resume summary* | Australia | *"ideally one to three sentences"* |
| JobsDB, *How to write a Resume Summary* (upd. 2019-02-23) | Hong Kong | *"customize the resume summary in 2-4 lines"* |
| JobStreet, *How to Write a Resume Summary* | Singapore | *"3 to 5 sentences"* |
| JobStreet, *…career summary for a fresh graduate* | Singapore | *"no longer than 2-3 sentences"* |
| JSON Resume schema, `basics.summary` | — (standard) | *"Write a short 2-3 sentence biography about yourself"* |
| VietnamWorks | Vietnam | *"ngắn gọn"* (concise); no count. A companion page gives **5–6 sentences** |

🚨 **SEEK owns all three of the first four rows.** One publisher, three markets, four numbers, two of them
on the same country's site. **If a number were load-bearing, this is not what it would look like.**

**Verdict: convention.** Our 55 is a product decision about density. So is 60–80. Neither is a finding.

---

### 2. Structure — is *identity / specialisation / quantified value* evidence-backed?

**No — grade D as a three-part formula. But one component of it has grade-B support, and the study that
provides it also says the placement does not matter.**

**The only experiment close to the question.** Bright & Hutton (2000), *"The Impact of Competency
Statements on Résumés for Short-listing Decisions"*, International Journal of Selection and Assessment
8(2), 41–53 — **62 managers and human resource consultants** rating genuine résumés with covering letters,
on **suitability, decision to interview, and overall ranking**. Findings:

- including **competency statements raised ratings** on all three;
- 🚨 **"the location of the competency statements did not influence ratings given to résumés"**;
- the extra information given to managers did not influence ratings.

Risavy's reading of it: *"the importance of including **between two to six** job competency statements
(i.e., descriptions of knowledge, skill, ability, and other characteristics) in order to improve the
hiring manager's impression of the applicant."*

⭐ **Read the location finding carefully, because it is the sharpest thing in this document.** It supports
*putting two to six concrete competency claims on the CV*. It does **not** support *a summary section*, and
it is the only direct experimental evidence either way. ⚠️ Grade B with a caveat: **paywalled (HTTP 402)**;
the design and results above come from the publisher's listing and search summaries plus Risavy's
peer-reviewed description. **The full text was not read.**

**What structures are documented, and by whom.** Five distinct shapes exist in citable sources, and they
are not variants of one another:

| Shape | Parts | Who documents it | Grade |
|---|---|---|---|
| **Summary of qualifications** | a **bulleted list** of top qualifications, not a paragraph | Harcourt & Krizan (1989); Harcourt et al. (1991), via Risavy | B |
| **Competency statements** | 2–6 KSAO descriptions, **anywhere on the page** | Bright & Hutton (2000) | B |
| **Hook / skills+achievements / metrics / value proposition** | four parts | SEEK (Australia) | UNCITED |
| **Title + certification + years, then 2–3 achievements** | two parts | JobsDB (Hong Kong) | UNCITED |
| **Self-introduction + short-term goal + long-term goal** | three parts | VietnamWorks, TopCV (Vietnam) | UNCITED |
| **Ambitions and aspirations** | one part | Textkernel parser's own section definition | A (as a *parser's* model) |

🚨 **Note what the dominant CV parser thinks the section is.** Textkernel's candidate data model names it
*"Summary/Ambitions Section"* and defines it as *"A section of the document detailing the candidate's
**ambitions and aspirations**."* That is an **objective**, not a value proposition. The machine that reads
most of the world's CVs models the top block the way 1990s résumé research did, not the way 2020s résumé
blogs do.

**Our own three-part shape is not among the documented ones.** *Identity + specialisation + quantified
value* appears in `2026-05-03_it-pm-cv-best-practices.md` and, in near-identical wording, across the
résumé-builder layer (*"professional identity, years of relevant experience, top two or three hard skills,
one quantified result"*). **It is a widely-copied assertion.** It is also, on the evidence in question 4,
a *reasonable* one — but it should be adopted as our house style, not cited as a standard.

---

### 3. Is it read at all?

**The strongest evidence says it carries no decision signal, and no study anywhere measures callback
rates for having a summary versus not.**

**The primary source, read in full.** Pina, Petersheim, Cherian, Lahey, Alexander & Hammond (2023),
*"Using Machine Learning with Eye-Tracking Data to Predict if a Recruiter Will Approve a Resume"*, Machine
Learning and Knowledge Extraction 5, 713–724 — **grade B, open access, extracted and read directly**:

- **221 recruiters** *"across various industries that hired computer science majors"*, recruited through
  STEM career fairs and businesses; Tobii Spectrum eye-trackers; **no time limit**;
- each saw **30 résumés**; after cleaning, **2,043 complete résumé screenings**, of which **1,257 (61.5%)
  were passed to the next stage**;
- eight areas of interest, *"from top to bottom… **Introduction**, Address, Education, Experience,
  Projects, Membership, Skills"* plus **Outside** (whitespace);
- top five predictive features: GazePoints:Outside (28.6), OutsideFromOutside (18.8),
  DwellDuration:Outside (18.2), StimulusDuration (18.1), **DwellDurationAverage:Experience (16.3)**;
- 🚨 the finding that answers this question verbatim: *"**no insights are gained with respect to the AOI
  sections for skills, projects, introduction, and address.** This does not necessarily indicate that
  these sections are not important to recruiters, only that the eye-tracking data from these sections
  were not substantially different between resumes moved to the next level and those that failed to do
  so."*

⚠️ **Transfer with care.** Entry-level computer-science student résumés, US south-western state, a
laboratory task. Our market is mid-career IT/PM in APAC. The finding is *no measured signal*, on a
population where the summary is least likely to carry one.

**The eye-tracking numbers everyone quotes, graded.** TheLadders 2012: **30 recruiters, 10 weeks**,
6.25 seconds, and *80% of that time on six things* — **name, current title/company, previous
title/company, both date ranges, education**. 🚨 **The summary is not on the list.** The 2018 update
raised it to 7.4 seconds. Both are **grade C — a résumé-services vendor**, never independently
replicated, résumé count never disclosed, and the 2018 study PDF now returns **403**.

**And a peer-reviewed figure that flatly contradicts them.** Pina et al. cite Schramm & Dortch (1991):
résumé screening lasts *"on average between thirty seconds and three minutes."* ⚠️ **Between 4× and 30×
TheLadders' number.** Both are in circulation; **they are not reconcilable and this document does not
reconcile them.** The 1991 figure is old and self-reported; the 2012/2018 figures are behavioural but
commercial. A design that only survives at 6 seconds is betting on the vendor.

**Callback-rate evidence for having a summary: grade D — none exists.** The résumé audit-study literature
(Bertrand & Mullainathan 2004 and the ~30 years of field experiments meta-analysed in PNAS 2017)
randomises **names and demographics**, never document structure. **No field experiment, correspondence
study or incentivised-résumé-rating design manipulates the presence of a summary.**

**Prevalence — the absence of a summary is normal, and two vendor samples disagree about how normal.**
**37%** of 176,220 Kickresume résumés (2022) carried a summary or objective; **70%** of the 394 Kickresume
résumés reported as *successful* (2024) did. ⚠️ **Same vendor, same platform, two years apart, and the
tempting inference — that summaries cause success — is exactly what the second sample's design cannot
support.** No comparison group; success is self-reported by people who chose to share.

⭐ **The one solid outcome study in this area does not isolate the summary.** Wingate, Robie, Powell &
Bourdage (2025), *"The Signals That Matter"*, IJSA 33, e70022 — **183 students** tracked through real
applications in a Canadian co-op programme: applicants whose résumés and cover letters showed more
**detail, clarity and structure** secured substantially more interviews per application and took less
time to place. ⚠️ Grade B, **paywalled (HTTP 402)**; abstract via the publisher listing and SSRN metadata,
**full text not read.** It supports *writing well*; it says nothing about a section.

---

### 4. Does a concrete achievement in the summary matter?

**There is genuine outcome evidence that concrete achievements beat capability claims on a CV. There is
no evidence that it matters *in the summary specifically* — and the one study that tested placement said
placement did not matter.**

**Grade B, all via Risavy's synthesis of the primary studies:**

- **Thoms, McMasters, Roberts & Dombkowski (1999)**, experimentally manipulated résumés rated by business
  professionals: *"including accomplishment statements (e.g., 'not one customer complaint in two years';
  p. 347) resulted in more favorable ratings than resumes that do not contain these types of
  statements."*
- **Knouse (1994)**, Chamber of Commerce members: self-descriptive statements *"that clarify and enhance
  credentials in a reasonable and not overly exaggerated manner"* produced **more favourable perceptions
  of interpersonal skill, overall impressiveness and hireability** — while also raising the desire to
  verify the applicant's background.
- **Knouse, Giacalone & Pollard (1988)**, executive MBA students: impression management produced **lower**
  perceptions of likability, truthfulness and employability, *"the effect was especially strong for
  resumes"*. Risavy resolves the two: **ingratiation and exaggerated trait claims hurt; concrete
  accomplishment statements help.**
- **Bright & Hutton (2000)**: 2–6 competency statements raise ratings; **location does not matter.**

Risavy's own conclusion: *"elaborating upon accomplishment statements as opposed to making unwarranted
and exaggerated self-descriptive statements appears to be beneficial advice for applicants."* His Table 1
row reads, under **Impression Management**: *"Do not include: flattery and ingratiation · unwarranted and
exaggerated self-descriptive statements."*

⭐ **This is the sourced case for #143's clause, and it is stronger than the brief assumed — but it is a
case about the CV, not about the summary.** Our corpus finding (three of five summaries are capability
lists: *"Proven ability to…"*, *"Expertise in…"*) is precisely the category the 1988/1994 pair calls a
**self-descriptive statement**, and Risavy's advice table tells applicants not to write. ⚠️ **If #143
mandates a concrete achievement, the evidence supports the *content* rule and is silent on the *placement*
rule.** Say so in the ADR rather than borrowing the achievement evidence to justify the section.

⚠️ **One caution the literature raises and we should not lose:** Knouse (1994) found favourable
impressions came **together with** a raised desire to verify the applicant's background. A quantified
claim in the opening line invites checking — which is fine when the claim is the person's own, and is
exactly the moment [ADR-0005](../adr/0005-a-stretch-belongs-to-its-advert.md)'s prepared interview
narrative earns its keep.

---

### 5. ATS — does the summary affect parsing or keyword scoring?

**Parsers model it. No ATS we can read stores it. No vendor documents it as weighted. It is text, and
text is searched.**

**What parsers do (grade A — the vendors' own schemas):**

| Parser | Treatment of the summary |
|---|---|
| **Textkernel** (acquired Sovren; behind a large share of the market) | Recognises a **"Summary/Ambitions Section"** — *"A section of the document detailing the candidate's ambitions and aspirations."* Note that its `summary` **object** is something else entirely: computed `totalExperienceYears`, `currentJob`, `currentEmployer`, `highestDegree`. |
| **Affinda** | Returns **`objective`** and **`summary`** as two separate fields under *Overview*, alongside achievements, associations and hobby. In the published sample output both are **null**. |
| **JSON Resume** (community standard) | `basics.summary` — *"Write a short 2-3 sentence biography about yourself"* — and a separate `basics.label` (*"e.g. Web Developer"*) that carries the professional identity **outside** the summary. |

**What ATSs store (grade A, and it is a short list):** Greenhouse holds structured **education only**;
Lever holds essentially nothing; iCIMS's published person profile holds a degree field group; **SAP
SuccessFactors' résumé parsing populates work experience, current employer and contact address**. ⚠️
**None of the four holds a summary, profile or objective field.** (Greenhouse/Lever/iCIMS verified in
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
§2.2; SuccessFactors added here.)

**What keyword search does.** Greenhouse Talent Filtering searches *"the full text of resumes and internal
notes"*, with Boolean queries and Preferred/Required keyword modes, behind a **Full Text Search** toggle.
⚠️ **Grade A for the mechanism, grade D for weighting** — Greenhouse's documentation says nothing about
any section being boosted, and neither does any other vendor's. **On the evidence available, a keyword in
the summary counts exactly as much as the same keyword in a bullet: once.**

🚨 **A discrepancy with our own prior research, flagged not resolved.**
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
§2.2 records the SEEK Profile as containing a *"personal summary"*. Reading SEEK's
**application-export** documentation for this round, the `CandidateProfile` exported to an employer's ATS
documents employment history, education, certifications, qualifications and personal contact details —
and **no free-text summary field**. Both may be true (the profile holds it; the export drops it), but
**the earlier note should not be relied on for what an employer receives in HK, SG or AU** until someone
reads the schema field-by-field.

**The forward-looking half, and it is not settled.** LLM-based screening is now real, and the résumé the
model reads is the whole document — so a summary is *at least* not invisible to it. ⚠️ Recent work (2024–25
arXiv and NAACL industry-track papers on bias in LLM résumé screening) reports **strong self-preference
for AI-written text** — one study puts LLMs choosing their own summaries **67–82%** of the time. **Grade
C–D, via search summaries; none of these papers was read in full and none isolates the summary section as
a treatment.** Recorded so a future round starts here, not as a finding.

---

### 6. Person and tense

**The ban on "I" is sourced. What is sourced is *third person*, which is not what we implemented. And
the dominant job board in our largest market instructs the opposite for this exact section.**

**The literature (grade B, dated).** Risavy's Table 1, under *Other Stylistic Issues*: *"write in the
**third person** (e.g., 'he', 'she', 'they') as opposed to the **first person** (e.g., 'I', 'we')"*,
cited to Arnulf et al. (2010), Bird & Puglisi (1986), Burns et al. (2014), Helwig (1985), Horn (1988),
Hornsby & Smith (1995), Oliphant & Alexander (1982), Penrose (1984), Stephens et al. (1979). Nine
citations, most from the 1980s.

⚠️ **Two things follow that our prompt does not currently distinguish.** First, the advice is a **binary
choice between third and first person** — the modern implied-subject, pronoun-free style (*"Delivered the
checkout replatform…"*) is **neither**, and no study in this list tested it. Second, the same table
reverses the rule for cover letters: *"write in the **first person**… as opposed to the third person."*
The person rule is a rule about **the document**, and it was decided before the pronoun-free style
existed.

🚨 **SEEK (Australia), read from their own page:** *"Write your resumé summary in the first person ('I led
a team of five')."* And immediately after: *"In the rest of your resumé, omit pronouns altogether."*
**That is a deliberate, published, market-specific split between the summary and everything else — and it
is the exact opposite of our rule 11.** JobsDB (Hong Kong) gives **no** person guidance and writes all
five of its sample summaries without pronouns. JobStreet (Singapore) gives none.

**Verdict.** *No first person on the CV body* is convention with old empirical backing.
**"No `I` in the summary" is convention with a live, named, dominant-channel dissent in one of our four
markets.** One of our six corpus CVs is following SEEK, not breaking a rule.

---

### 7. The target / objective statement

**"Career objectives are replaced by the Professional Summary" is a vendor claim with no source, and the
peer-reviewed synthesis says something close to the opposite.**

**Risavy (2017) §2.2**, read verbatim:

> *"Although recent research has provided support for the notion that there is no need for a **personal
> opening** in a resume (Burns et al., 2014), including a **job objective and/or a career objective** has
> traditionally been found to be important information to include in a resume (Harcourt & Krizan, 1989;
> Harcourt, Krizan, & Merrier, 1991; Hornsby & Smith, 1995; Hutchinson, 1984; Hutchinson & Brefka, 1997;
> Schramm & Dortch, 1991). Harcourt and colleagues' (1991) sample of **212 campus recruiters**
> demonstrated a preference for a **career objective** over a job objective or a combined career and job
> objective… Lastly, a **summary of qualifications** may also be important to include… however, future
> research is also needed to determine whether including a summary of qualifications is effective if a
> career objective… has already been included."*

> *"Overall, the best available advice for resume writers is to **avoid a personal opening and to instead
> include an objective or a summary of qualifications**."*

His Table 1 row reads: **Include:** *objective · summary of qualifications*. **Do not include:** *personal
opening*.

⚠️ **Read the three terms precisely, because the repo currently collapses them.** A **personal opening**
(the thing the evidence says to drop) is a self-descriptive greeting — not an objective and not a
qualifications summary. An **objective** states what the applicant is seeking. A **summary of
qualifications** is documented in this literature as a **bulleted list of top qualifications**. Risavy's
advice is **"objective OR summary"**, with the question of whether both are needed **explicitly open**.

**Where "replaced by" comes from.** Résumé-writing firms — TopResume (*"Ditching the Objective"*),
Randstad (*"why remove the objective statement"*), iHire, The Muse. **UNCITED, every one, and each sells
résumé writing.** Their argument (an objective states what *you* want, not what you deliver) is
reasonable; it is not a finding.

**The market channels have not replaced it either.** JobsDB Hong Kong publishes a **separate**
*"How to write a career objective in a resume?"* article. JobStreet Singapore publishes
*"Career objective examples for your resume"*. SEEK Australia keeps them **distinct and both live**:
*"A career objective outlines the future you're hoping to achieve, while a resumé summary is an overview
of your career so far,"* with the objective optional. **And Vietnam treats the objective as core** — see
question 8.

**Our corpus CV with *"Seeking a B2B support role in Lisbon"* is doing the thing 212 campus recruiters
preferred and every résumé vendor calls dead.** ⚠️ Both those sentences are true. #143 should choose
knowing that, not knowing only the second.

---

### 8. Market variation — Hong Kong, Singapore, Vietnam, Australia

**Three of the four are one convention published by one company. Vietnam is genuinely different, and the
difference is the objective, not the length.**

🚨 **The controlled comparison this question deserves already exists, because SEEK owns the channel in
three of our four markets** — SEEK (AU), JobsDB (HK), JobStreet (SG). Same corporate publisher, same
content operation, three country sites:

| | Length | Structure | Person | Objective |
|---|---|---|---|---|
| **Australia** (SEEK) | *"ideally one to three sentences"* | hook · key skills+achievements matched to the ad · metrics · value proposition | 🚨 **first person in the summary**, no pronouns elsewhere | distinct, optional, **not** replaced |
| **Hong Kong** (JobsDB) | *"2-4 lines"* | title + certification + years, then **2–3 achievements**; *"give numbers, if possible"* | none stated; samples are pronoun-free | separate article, still published |
| **Singapore** (JobStreet) | *"3 to 5 sentences"* — and *"no longer than 2-3 sentences"* on another page of the same site | qualifications snapshot; match to the job description; keywords | none stated | separate article, still published |
| **Vietnam** (VietnamWorks / TopCV) | *"ngắn gọn"*; a companion page gives **5–6 sentences** | ⭐ **giới thiệu bản thân + mục tiêu nghề nghiệp**, the objective split **short-term (6mo–1yr / 1–3yr)** and **long-term (>3yr)** | none stated | 🚨 **core, expected, and named in the section title** |

⭐ **The finding, and it is a real one:** the three SEEK-group markets disagree with each other on the
number while agreeing on everything that matters (short, tailored to the ad, quantified where possible).
**A publisher that genuinely believed the number would not print three of them.**

**Vietnam is the one genuine divergence, and it repeats the shape
[`market-strip-lists.md`](market-strip-lists.md) found:** the domestic Vietnamese-language convention is a
different document from the English-language international CV. VietnamWorks calls the block
*"vô cùng quan trọng"* (extremely important) and bundles the **self-introduction with the career
objective**, alongside a portrait photo in the same personal block — the same domestic convention
`market-strip-lists.md` traced to the *sơ yếu lý lịch*. ⚠️ **JobCrush renders an English-language,
ATS-aware CV, which is that document's channel (b)** — so Vietnam's divergence probably does not reach
our output, exactly as the strip-list research concluded for the seven personal fields.

**No national or government career service in any of the four markets publishes a summary rule.**
Singapore's **MyCareersFuture** (Workforce Singapore) has an article titled *Improve Your Resume's
Executive Summary* (2021-09-10) — ⚠️ **its body could not be read; the fetch returned navigation only**.
Hong Kong's **Labour Department** publishes job-hunting guidance covering chronological order, action
verbs, tailoring and excessive personal information, and **nothing on a summary section**. Australia's
**yourcareer.gov.au** returned no reachable summary guidance; every search result was a commercial résumé
writer. Vietnam has no equivalent body. **Grade D across all four — this is the same source void
[`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) and
[`market-strip-lists.md`](market-strip-lists.md) both recorded, and it survives intact.**

**Answer to the question as asked: they are not identical, but the variation is editorial, not
cultural — except in Vietnam, where it is real and probably does not reach us.**

---

## What I could not establish, and why

**1. Bright & Hutton (2000) in full.** Wiley returned **HTTP 402**. The sample (62 managers and HR
consultants), the three outcome measures, the positive main effect, and 🚨 **the null effect of location**
all come from the publisher's listing and search summaries, corroborated by Risavy's peer-reviewed
description of the same study. **The finding that most affects #143 is the one I read second-hand.** If
#143 turns on it, buy the paper.

**2. Wingate et al. (2025) in full.** IJSA returned **402**; SSRN returned **403**. Sample (183 students,
Canadian co-op programme) and headline finding via publisher listing and search summaries.

**3. Whether the eye-tracking studies' "Introduction" AOI is what we call a summary.** Pina et al. name
the top block *Introduction* and show it boxed in their Figure 1, which I could not render. On
entry-level CS student résumés it may be a name-and-contact header rather than a professional summary.
⚠️ **This is the single biggest interpretive risk in finding 3 and I could not close it.** The paper's
own AOI list has *Address* as a separate area, which argues Introduction is the summary — but that is
inference, not verification.

**4. TheLadders 2018 study document.** **403.** The 7.4-second figure and its element list come from the
2018 press release and HR Dive's coverage. No résumé count has ever been published for either the 2012 or
the 2018 study. Same gap
[`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
recorded; unchanged.

**5. MyCareersFuture's own executive-summary guidance.** The page exists and is Singapore government
content — the single most authoritative market source that could exist for us — and **the fetch returned
navigation chrome, not the article**. Worth one manual look before #143 decides anything Singapore-specific.

**6. TopCV's Vietnamese guidance directly.** **403 (Cloudflare)**, the same gate `market-strip-lists.md`
hit. Vietnamese findings rest on **VietnamWorks read directly** plus TopCV via search summaries.

**7. Whether any ATS weights the summary section in ranking.** No vendor documents weighting either way.
**Grade D, and the absence is the answer for now** — but it is an absence of documentation, not a
verified absence of behaviour, and closed-source matching engines (Workday, iCIMS AI, HiredScore) publish
nothing testable.

**8. Whether a summary changes callback rates.** 🚨 **No study exists.** Thirty years of résumé audit
studies randomise demographics, never document structure. This is the question the product would most
like answered and the one with the least evidence behind it anywhere.

---

## ⚠️ Three things this research found that #152 did not ask for

**1. The literature's *"summary of qualifications"* is a bulleted list, not a paragraph.** Harcourt &
Krizan (1989) and Harcourt et al. (1991), as synthesised by Risavy, treat it as a list of top
qualifications. **Our Draft schema renders a prose summary.** Nothing here says prose is wrong — but the
one shape with grade-B support behind it is a shape we do not produce, and #143 should know that before
citing the literature in support of what we already build.

**2. `prompts/preview-tailor.md` rule 11 bans first person on the whole CV, and rule 10 caps the
summary — the two rules together encode a position that one of our four markets' dominant job board
publicly contradicts for this exact section.** Not a defect; a choice that is currently undocumented as a
choice.

**3. The résumé literature has an *ordering* finding that our own council already overrode, and they
agree.** Risavy: education first, experience second — *"however, future research should assess the
efficacy of this ordering for non-student applicants… as it could be reasoned that for these applicants,
the work experience section is their greatest asset and thus, should precede the education section."*
Our `2026-05-03_it-pm-cv-best-practices.md` §1 carries a 2026-06-11 supersession doing exactly that.
**Recorded because it is the one place our house rules and the peer-reviewed literature independently
converged.**

---

## Sources, with liveness

**Peer-reviewed — read in full from the publisher's own file**

- **Risavy, S. D. (2017).** *The Resume Research Literature: Where Have We Been and Where Should We Go
  Next?* Journal of Educational and Developmental Psychology 7(1), p. 169. doi:10.5539/jedp.v7n1p169.
  **The single most useful source in this document** — a synthesis of the empirical résumé literature with
  a full advice table (Table 1) and an open-questions table (Table 2). Open access.
  https://www.ccsenet.org/journal/index.php/jedp/article/download/66404/35947
- **Pina, A.; Petersheim, C.; Cherian, J.; Lahey, J. N.; Alexander, G.; Hammond, T. (2023).** *Using
  Machine Learning with Eye-Tracking Data to Predict if a Recruiter Will Approve a Resume.* Machine
  Learning and Knowledge Extraction 5, 713–724. doi:10.3390/make5030038. **221 recruiters, 2,043 complete
  screenings, eight AOIs including Introduction.** Open access (CC BY); mdpi.com 403s, the article PDF on
  mdpi-res.com does not. https://doi.org/10.3390/make5030038

**Peer-reviewed — paywalled, read via publisher listing, search summaries, and peer-reviewed description**

- **Bright, J. E. H., & Hutton, S. (2000).** *The Impact of Competency Statements on Résumés for
  Short-listing Decisions.* International Journal of Selection and Assessment 8(2), 41–53.
  doi:10.1111/1468-2389.00132. 62 managers/HR consultants. 🚨 **"the location of the competency statements
  did not influence ratings."** ⚠️ HTTP 402. https://onlinelibrary.wiley.com/doi/abs/10.1111/1468-2389.00132
- **Wingate, T. G.; Robie, C.; Powell, D. M.; Bourdage, J. S. (2025).** *The Signals That Matter: Resumes,
  Cover Letters, and Success on the Job Search.* International Journal of Selection and Assessment 33,
  e70022. 183 students, real applications. ⚠️ HTTP 402 (Wiley) / 403 (SSRN).
  https://onlinelibrary.wiley.com/doi/10.1111/ijsa.70022
- **Studies cited through Risavy and not read at source** — Thoms, McMasters, Roberts & Dombkowski (1999),
  J. Bus. Psychol. 13, 339–356 (accomplishment statements) · Knouse (1994), J. Bus. Psychol. 9, 33 ·
  Knouse, Giacalone & Pollard (1988) · Harcourt, Krizan & Merrier (1991), 212 campus recruiters ·
  Harcourt & Krizan (1989) · Hutchinson & Brefka (1997), Bus. Commun. Q. 60, 67–75 · Burns, Christiansen,
  Morris, Periard & Coaster (2014), J. Bus. Psychol. 29, 573–591 · Schramm & Dortch (1991), Bull. Assoc.
  Bus. Commun. 54, 18–23 (**30 seconds to 3 minutes**) · Arnulf, Tegner & Larssen (2010) · Cole, Rubin,
  Feild & Giles (2007), 244 experienced recruiters. **All grade B by provenance, all second-hand here.**

**Vendor schemas — grade A, the vendor's own published model**

- **Textkernel candidate data model** — *"Summary/Ambitions Section: A section of the document detailing
  the candidate's ambitions and aspirations."* Live.
  https://developer.textkernel.com/Parser/master/data_model/candidate-data-model/
- **Affinda resume parser, data extracted** — `objective` and `summary` as separate Overview fields; both
  null in the published sample. Live. https://docs.affinda.com/resumes/data-extracted
- **JSON Resume schema** — `basics.summary`: *"Write a short 2-3 sentence biography about yourself"*;
  `basics.label`: *"e.g. Web Developer"*. Live (jsonresume.org 503'd; read from the canonical repo).
  https://raw.githubusercontent.com/jsonresume/resume-schema/master/schema.json
- **Greenhouse Talent Filtering / full-text search** — searches *"the full text of resumes and internal
  notes"*; Boolean, Preferred/Required. **No documented section weighting.** Live.
  https://www.greenhouse.com/product-features/greenhouse-talent-filtering-keyword-search ·
  https://support.greenhouse.io/hc/en-us/articles/115004600186-Search-resumes-for-keywords
- **SAP SuccessFactors résumé parsing** — populates work experience, current employer and contact address;
  **no summary field**. Live. https://help.sap.com/docs/successfactors-recruiting/setting-up-and-maintaining-sap-successfactors-recruiting/configuring-resume-parsing
- **SEEK Developer, application export — candidate profiles** — employment history, education,
  certifications, qualifications, contact details. ⚠️ **No free-text summary field documented**; conflicts
  with our own earlier note. Live. https://developer.seek.com/use-cases/application-export/candidate-profiles

**Vendor analytics — grade C, sample stated, method not published, commercial interest**

- **Kickresume, *This is What an Ideal Resume Looks Like*** (2024-05-20) — **394** self-selected successful
  résumés; **70%** had a summary; **mean 57 words, range 7–289**; median résumé 443 words.
  https://www.kickresume.com/en/press/successful-resumes-analysis/
- **Kickresume résumé statistics** — 176,220 résumés (2022); **37%** included a summary or objective.
  https://www.kickresume.com/en/blog/resume-statistics/
- **TheLadders eye-tracking, 2012 and 2018** — 30 recruiters over 10 weeks (2012); 6.25s → 7.4s; the six
  elements looked at, **summary not among them**. ⚠️ Study PDF **403**; résumé count never published.
  https://www.prnewswire.com/news-releases/ladders-updates-popular-recruiter-eye-tracking-study-with-new-key-insights-on-how-job-seekers-can-improve-their-resumes-300744217.html ·
  https://www.hrdive.com/news/eye-tracking-study-shows-recruiters-look-at-resumes-for-7-seconds/541582/

**Market channels — UNCITED guidance, but this is what our users are told**

- **SEEK (Australia)** — *"ideally one to three sentences"*; hook / skills+achievements / metrics / value
  proposition; 🚨 *"Write your resumé summary in the first person"*; objective distinct and optional.
  https://au.seek.com/career-advice/article/resume-summary
- **Jobsdb (Hong Kong)** — *"customize the resume summary in 2-4 lines"*; title + certification + years,
  then 2–3 achievements; *"give numbers, if possible"*. Updated **2019-02-23**.
  https://hk.jobsdb.com/career-advice/article/how-to-write-a-resume-summary ·
  https://hk.jobsdb.com/career-advice/article/how-to-write-a-career-objective-in-resume
- **Jobstreet (Singapore)** — *"3 to 5 sentences"*, and *"no longer than 2-3 sentences"* elsewhere on the
  same site. https://sg.jobstreet.com/career-advice/article/how-to-write-a-resume-summary-with-examples ·
  https://sg.jobstreet.com/career-advice/article/write-outstanding-career-summary-fresh-graduate ·
  https://sg.jobstreet.com/career-advice/article/write-winning-career-objective-4-steps
- **VietnamWorks (Vietnam)** — *"Giới thiệu bản thân và mục tiêu nghề nghiệp là phần vô cùng quan trọng"*;
  objective split short-term / long-term. Read directly.
  https://www.vietnamworks.com/hrinsider/cach-gioi-thieu-ban-than-va-muc-tieu-nghe-nghiep-trong-cv.html
- **TopCV (Vietnam)** — ⚠️ **403 (Cloudflare)**; via search summaries only.
  https://www.topcv.vn/gioi-thieu-ban-than-trong-cv

**Government and national career services — grade D on this question, checked and empty**

- **MyCareersFuture / Workforce Singapore**, *Improve Your Resume's Executive Summary* (2021-09-10) —
  ⚠️ **article body not retrievable**; only navigation returned.
  https://www.content.mycareersfuture.gov.sg/improve-resumes-executive-summary-these-tips-samples
- **Hong Kong Labour Department**, Interactive Employment Service / *Job Hunting Briefcase* — chronological
  order, action verbs, tailoring, no excessive personal information. **Nothing on a summary section.**
  https://www2.jobs.gov.hk/0/en/information/ourservices/findjobs/
- **yourcareer.gov.au (Australia)** — no reachable summary guidance; searches returned commercial résumé
  writers only.

**Checked and not relied on**

- The entire résumé-builder length layer — Enhancv, Jobscan, QuillBot, ResumeGenius, Zety, Novoresume,
  climbtheladder, Teal, Monster, ResumeLab. **Mutually citing, no method, several now reasoning backwards
  from Kickresume's 57-word mean.** Cited above only where naming them was the point.
- **TopResume, Randstad, iHire, The Muse** on *"the objective is dead"* — résumé-writing vendors, no
  source, direct commercial interest in the answer.
- **Résumé audit-study literature** (Bertrand & Mullainathan 2004; PNAS 2017 meta-analysis of field
  experiments) — checked because #152 asks about callback rates. **It randomises demographics, never
  document structure.** Nothing to take.
- **2024–25 LLM-résumé-screening papers** (arXiv, NAACL industry track) — none isolates the summary
  section; noted in question 5 as a starting point for a future round, not as a finding.

**Prior research this builds on (do not re-derive)**

- [`cv-elements-what-cvs-contain-and-what-employers-screen.md`](cv-elements-what-cvs-contain-and-what-employers-screen.md)
  — the 37% figure, the Ladders grading, the résumé-builder sampling bias, and the Greenhouse / Lever /
  iCIMS / Textkernel schema table this document extends.
- [`market-strip-lists.md`](market-strip-lists.md) — the four-market frame, the Vietnamese
  domestic-vs-international channel split, and the HK/SG CV-convention source void.
- [`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) — the original record that high-traffic
  career keywords produce a search space of SEO and AI-generated content.
