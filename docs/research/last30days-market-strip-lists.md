# Market strip-lists — what the last 30 days actually says

Research leg for [#151](https://github.com/adrien-mounier/jobcrush-app/issues/151) (recent-movement half;
the deep-source half runs in parallel against statutes and regulator guidance). Serves
[ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) clause 2, which fixes the vocabulary at
seven names: **date of birth · age · marital status · photograph · race · religion · gender**.

**Windows:** stated per topic, because the four markets move at four different speeds.

| Topic | Window used | Why |
|---|---|---|
| Australia — recruiter practice | **30 days** (2026-07-07 → 2026-08-06) | Live thread in the window; strict window works |
| Vietnam — convention | **~12 months** | The Vietnamese-language advice corpus is dated but not daily; a 30-day window returns nothing |
| Singapore — statutory + regulator | **~18 months** (Act passed 2025-01-08 → TAFEP guidance 2026-05-18) | Commencement is ~end-2027; a 30-day window cannot see it |
| Hong Kong — both | **30 days social + ~12 months guidance** | 30-day social returned zero; guidance is slow-moving |
| ATS / AI screening | **30 days social + ~24 months evidence** | The load-bearing study is 2024; nothing shipped in the window |

**Run date:** 2026-08-06.

🚨 **Read the whole file in the frame ADR-0007 already set.** Everything below describes **what employers
must do** and **what recruiters expect**. None of it describes what a candidate may lawfully write. Every
obligation named here points at an employer's *process*; nothing stops a candidate putting any of the seven
on their own document, in any of the four markets. A page that says *"illegal to include"* would tell our
user something false about the law.

---

## Bottom line

**The ticket's central expectation — three markets agree, Vietnam diverges — survives, but the Vietnam half
is wrong in a way that changes what the page should say. And the strongest finding in the window is that
the seven-name vocabulary misses the channel that actually carries race, religion and gender to a screener.**

Five findings, in order of how much they should move the decision:

1. 🚨 **Vietnam is not one divergence. It is splitting down the middle of the seven, and the half that is
   drifting away is the half we can act on.** Vietnamese-language career advice in 2026 tells candidates to
   **drop** date of birth, ethnicity, religion and marital status — [CareerLink.vn](https://www.careerlink.vn/cam-nang-viec-lam/viet-cv-resume/cach-viet-thong-tin-ca-nhan-trong-cv)
   (27/5/2026) says of ethnicity and religion, verbatim, *"Dân tộc và tôn giáo: **bỏ hoàn toàn**"* — drop
   completely — and cites **Labour Code 2019 Article 8** as the reason. It keeps the **photograph**. The
   English-language sources the ticket's assumption rests on say the opposite: that date of birth, marital
   status and photo are all Vietnamese norms. **The photograph is the durable convention; date of birth and
   marital status are actively contested, in Vietnamese, right now.** ⚠️ **And the photograph is the one item
   ADR-0007 clause 6 already records as inert for us** — the renderer has no image slot. So Vietnam's *live*
   divergence is the one we cannot act on, and its *contested* half is drifting toward the other three.

2. 🚨 **The seven-name vocabulary cannot reach the channel that actually carries race, religion and gender —
   the candidate's name — and it must not try.** The window's clearest example is
   [r/resumes, 2026-08-05](https://reddit.com/r/resumes/comments/1vggwly/is_my_muslim_sounding_last_name_on_resume/):
   *"Is my Muslim sounding last name on resume limiting call backs/interviews I am getting?"* Top reply,
   **70 upvotes**: *"Ethnic names get less interviews. Proven"* — u/bruckout. A second commenter reports the
   controlled experiment by accident: *"He actually accidentally applied to the same job twice, once with his
   real name, and once with his American name. Guess who got the interview! It was the exact same resume."*
   (u/darksideoftheday, 41 upvotes). The peer-reviewed backing is real and traceable: **Wilson & Caliskan,
   AAAI/ACM AIES 2024** ([arXiv 2407.20371](https://arxiv.org/abs/2407.20371)) tested 3M+ job/race/gender
   combinations across three retrieval models and found **white-associated names preferred 85% of the time,
   female-associated names 11%**, with Black male names disadvantaged in up to 100% of comparisons in some
   occupations. **A strip-list of seven declared fields removes none of this.** This is not an argument to
   widen the list — a product that edits a person's name is a different and much worse product. It is an
   argument that **the page must not be sold internally as "we handle discrimination signals."** It handles
   seven declared fields. That is a smaller and more honest claim.

3. **Australia is the only market with a live, in-window, in-market conversation, and it is unanimous — on
   employer-risk grounds, not candidate-obligation grounds.** [r/auscorp, 2026-07-29, "Photo on resume?"](https://reddit.com/r/auscorp/comments/1v9o8ml/photo_on_resume/)
   — **64 comments**, and not one says yes for an ordinary role. *"No don't do this"* (61 upvotes) ·
   *"Nope. Not in Australia. Dont do it"* (39) · and from someone who works in HR, **17 upvotes**:
   *"I work in HR. Do not add a photo. Plenty of managers and recruitment teams will discriminate based on
   gender, age, ethnicity, etc."* The sharpest line for our purposes is u/Suitable_Pass9702:
   ⭐ ***"Absolutely not. They don't want any claims of discrimination."*** **That is the whole ADR-0007 framing
   arriving from the outside** — the pressure is on the employer's exposure, not on the candidate's legality.
   The thread also reports employer-side redaction happening in the wild: *"most good HR teams will remove
   photos and sometimes names to prevent biased candidate picking"* (u/Dangerous-Board9471). ⚠️ Vote counts
   are archive-capture floors; see the integrity note.

4. **Singapore's commencement has not moved, and the regulator did publish pre-commencement recruitment
   guidance — but it names only two of the seven.** No new commencement date and no slippage: the Workplace
   Fairness Act still reads **end-2027**, phased at 25+ employees first and 5-24 employees around 2030.
   TAFEP published [*Fair Recruitment Practices for Employers in Singapore — Preparing for the Workplace
   Fairness Act*](https://www.tal.sg/tafep/resources/articles/2026/fair-recruitment-practices-for-employers-in-singapore---preparing-for-the-workplace-fairness-act)
   on **18 May 2026** — genuine pre-commencement movement. But on application forms it names exactly two
   things: *"Personal details such as **NRIC number and date of birth** should generally be omitted and
   collected only at the point of the job offer."* **Photograph, marital status, race, religion and gender
   are not named for the form.** ⚠️ **So the assumption that the regulator will hand us the strip-list is not
   yet true** — as of the run date, the authoritative Singapore source covers **one** of our seven names
   (date of birth), plus NRIC, which is not in our vocabulary at all.

5. **Hong Kong: no movement found, and no social conversation whatsoever. Reported as a finding, not as a
   gap.** I pulled **35 job-tagged posts from r/HongKong** in the 30-day window. **Zero** are about a
   photograph, an age, a date of birth, a marital status, a race, a religion or a gender on a CV. The one
   thread that looked on-topic — *"Jobs & Recruitment Practices in HK"* — **was deleted by its author**
   (*"I ended up deleting the post"*). The written guidance is stable and slow: PCPD's Code of Practice on
   Human Resource Management dates to 2001, revised **April 2016**, and its recruitment-specific rule is
   about the **HKID card**, not our seven. Commercial 2026 HK CV guides agree that date of birth *"used to be
   common"* and is *"no longer standard"* — but they disagree with each other on the photograph, which
   [Morgan Philips HK](https://hk.morganphilips.com/insights-hk/how-to-write-a-cv-for-hong-kong-in-2026)
   still frames as a Hong Kong-specific expectation.

**What contradicts the established picture, in one line each:**

- **Vietnam's own language contradicts the English-language description of Vietnam** (finding 1). This is the
  contradiction the ticket was hoping for, and it is the reason to research a market in its own language.
- **Australia's practitioners state the market split themselves** — u/thrr4, 53 upvotes: *"Common in Asia.
  Not in Australia."* Our four markets are not four unknowns; the people in them already know the shape.
- **"Blind recruitment works" is contradicted by Australia's own government trial** (see debunks).
- **The `SGD 50,000 per violation` figure that reached this project is wrong** (see debunks).

**What has no evidence at all:** no ATS or screening vendor shipped a personal-detail redaction feature in
the 30-day window. The features exist (iCIMS resume redaction; Pinpoint de-identification, which strips
*"college graduation years, pronouns, surnames"*) but **none has a dated launch inside the window**, and all
are **employer-side** tools — they redact what the employer's reviewer sees. **None of them is a thing our
product could integrate with or a thing that changes what a candidate's document should contain.**

---

## Findings by theme

### 1. Singapore — the statute is fixed, the guidance is thin, the recruiter layer disagrees with itself

**Employer obligation (high confidence, dated, sourced).** The Workplace Fairness Act was passed
**8 January 2025**; the Workplace Fairness (Dispute Resolution) Bill followed on **4 November 2025**.
Commencement is **expected by end-2027**, phased: employers with **25 or more** employees first, employers
with **5-24** in a later phase expected **around 2030**. Protected characteristics span age, nationality,
sex, marital and family status, pregnancy, caregiving responsibilities, race, religion, language and
disability. **Nothing in the window moved any of these dates.**

**What that means for a form, per the regulator itself.** TAFEP's 18 May 2026 article is the most recent
authoritative statement and it is narrow:

> *"Personal details such as NRIC number and date of birth should generally be omitted and collected only at
> the point of the job offer."*

and, where an employer does need something before offer, *"employers should state the reasons, which should
be job-related."* On advertisements the rule is broader — selection criteria must relate to qualifications,
skills, knowledge and experience, and protected attributes appear only where a genuine job requirement.

⚠️ **Read the gap carefully.** The advertisement rule covers protected attributes generally; the
**application-form** rule names **NRIC and date of birth only**. If our Singapore page is meant to be a
mechanical walk from a regulator's list to a strip-list, **that walk currently yields one of our seven names.**
Everything else on the Singapore page will come from the broader anti-discrimination principle plus
convention — which is a weaker, faster-rotting source, and the page's next-check date should say so.

**Recruiter expectation (lower confidence, convention, drifting).** The commercial Singapore CV corpus is SEO
content marketing and it **contradicts itself on the photograph**: some guides say the Fair Consideration
Framework discourages photos, then immediately say *"many employers still expect them, especially for
client-facing roles"* and that date of birth is *"more common in applications to local companies and
government-linked entities than to Western MNCs."* **No method behind any of it.** Treat the direction as
real and the specifics as unsourced.

**Singapore social: empty.** r/askSingapore returned **9 posts** on `resume`/`CV` in the window — cover
letters, a private-degree question, a probation-termination question. **None about personal details.**
r/singapore returned **zero** on-topic. Two queries failed outright (HTTP 422). **9 posts is not a corpus**;
this is unmeasured for social, not measured-and-absent.

### 2. Vietnam — the expected divergence, and it is coming apart

This is the finding with the most decision-value, so here is the evidence side by side.

| | **English-language sources** | **Vietnamese-language sources, 2026** |
|---|---|---|
| Photograph | Required / "a major requirement" | **Keep** — *"ảnh rõ mặt, trang phục lịch sự"* (clear face, smart clothing) |
| Date of birth | "Commonly listed", a norm | **Split** — CareerLink: omit the detailed date; JobsGO: still lists it as required |
| Marital status | "A norm" | **Drop unless the job description asks** — both sources |
| Ethnicity / religion | Not discussed | **"bỏ hoàn toàn"** — drop completely (CareerLink) |
| ID number (CCCD/CMND) | Not discussed | **Only at contract signing** (CareerLink) |
| Stated reason | "It's the culture" | **Labour Code 2019, Article 8** — anti-discrimination in recruitment |

**The two Vietnamese sources disagree with each other, and that disagreement is the finding.**
[CareerLink.vn](https://www.careerlink.vn/cam-nang-viec-lam/viet-cv-resume/cach-viet-thong-tin-ca-nhan-trong-cv)
(dated **27/5/2026**) gives a strip-list that is closer to Singapore's than to the Vietnam of the ticket's
assumption. [JobsGO.vn](https://jobsgo.vn/blog/cach-viet-cv-xin-viec/) still lists *"Ngày tháng năm sinh"*
(date of birth) among the required personal-information fields, and calls marital status *"thường không bắt
buộc"* — usually not mandatory. **Both keep the photo.** A convention that two major domestic career sites
describe differently in the same year is a convention in motion, not a settled one.

**Statutory backing exists and is not new.** Vietnam's Labour Code prohibits recruitment discrimination on
grounds including race, skin colour, ethnicity, gender, age, pregnancy, **marital status**, religion and
disability, with administrative fines of **VND 10-20 million**. So the Vietnamese advice is not a Western
import — it is domestic advice citing domestic law.

**Vietnam social in English: genuinely empty, and this is a result.** r/VietNam returned **2 on-topic-shaped
posts** across `CV` and `resume` queries in the window, and both were off-topic (a shipping request, a
recruiting ad). One query failed (HTTP 422). **The English-language internet has no Vietnamese conversation
about this** — exactly as #151 anticipated. **Do not read the silence as agreement with the English-language
description of Vietnam; finding 1 shows it is not.**

### 3. Australia — the one live vein, and it says the quiet part

**Employer obligation (stable, nothing new in the window).** The Age Discrimination Act 2004 bars stating an
age preference in a job advertisement; terms like *"mature"*, *"senior"*, *"junior"* are cited as indirect
discrimination. Five federal Acts govern the area. **The one recent structural change is not about our
seven**: the **positive duty** introduced **December 2023** sits under the **Sex Discrimination Act**, not
the age regime, and is about sexual harassment and sex discrimination. Some states (Victoria) carry broader
positive duties. **No Australian anti-discrimination change in the 30-day window touches what a CV contains.**

**Recruiter expectation (high confidence for once — a real thread, in the window, in the market).** The
r/auscorp thread is the single best piece of evidence this run produced. Beyond the quotes in the bottom
line, three things in it bear directly on our design:

- **The market split is stated by practitioners, not inferred by us.** *"Common in Asia. Not in Australia"*
  (u/thrr4, 53) and *"I very rarely see it in Australian resumes. I see a fair number from other places…
  normal in Germany and surrounds, Korea, and South America"* (u/komatiitic, 3).
- **A practitioner strip-list appears spontaneously, and it matches ours plus extras:** *"Don't include:
  photos, hobbies, date of birth, every single job and course you've ever done and names of referees"*
  (u/TGin-the-goldy).
- **The ATS is cited as a reason, twice, in opposite directions.** *"Not good to do anymore in Aus. The
  platforms/AI can't compute"* (u/Interesting-Cut6994) and *"In 2022 I did. Got the job. Not anymore as AI
  ATS doesnt really judge based on look"* (u/not-a-random-guy). ⚠️ **Neither is evidence about ATS behaviour**
  — they are candidate folk-theories. Do not carry them into a design.

⚠️ **One upvoted factual error, worth recording as a caution about crowd sourcing.** u/RoomMain5110:
*"Almost mandatory in the US. But, as you say, never done here."* **The US convention is strongly against
photos on résumés** — this is simply wrong, and it sat in the thread uncorrected. A thread that is unanimous
is not thereby accurate.

**Second Australian data point, weaker but present.** The `resume` query on r/auscorp returned **24 posts**
in the window; only the photo thread is on-topic for the seven. r/AusFinance returned **5**, none on topic;
two of its queries failed (HTTP 422).

### 4. Hong Kong — stable, quiet, and internally inconsistent at the recruiter layer

**Employer obligation.** PCPD's **Code of Practice on Human Resource Management** came into force
**1 April 2001** and was **revised April 2016**. Its recruitment content is about *relevance* and *retention*
— collect only data relevant to assessing suitability; do not keep unsuccessful applicants' data beyond two
years — plus one specific rule that is **not** in our vocabulary: **do not collect a copy of the HKID card
until the applicant has accepted an offer**. Separately, the EOC administers four discrimination Ordinances
(sex, disability, family status, race) and trains employers on recruitment and selection.

**Nothing moved in the window.** I found no PCPD enforcement action, no new guidance note, and no updated
HR code bearing on our seven. The only PCPD items surfacing in recent search results are **its own job
vacancies** — which is a retrieval artefact, not news.

**Recruiter expectation: the sources disagree on the photograph.** Commercial 2026 HK CV guides split. Some
advise against HKID number, date of birth, marital status, nationality and religion. Morgan Philips — an
actual recruitment firm writing for the HK market in 2026 — describes a professional photo as one of the
*"Hong Kong-specific expectations"* alongside language proficiency and a right-to-work statement. **On date
of birth the sources agree**: it *"used to be common"* and is *"no longer standard"*, with age-bias risk
named as the reason.

**Hong Kong social: measured, and empty.** 35 job-tagged posts in the window, zero on the seven. See the
bottom line.

### 5. Cross-cutting — ATS redaction and AI screening

**Redaction is an employer-side feature, it is not new, and nothing shipped in the window.** iCIMS offers
resume redaction to *"anonymize information"*; Pinpoint de-identifies by *"removing college graduation
years, pronouns, surnames"*. GDPR-driven auto-anonymisation on retention expiry is a standard ATS feature.
**None of this has a dated launch in the 30-day window**, and every one of these tools acts on what the
**employer's reviewer** sees — after the CV has arrived. **It changes nothing about what our user's document
should contain**, and it is not a route we could integrate with.

⚠️ **Note what Pinpoint strips, though, because it is the same finding as #2:** graduation years, pronouns
and **surnames**. **Two of those three are not in our seven, and one of them is the name.** The vendors
building the employer-side mirror of our feature have concluded that the seven declared fields are not where
the signal is.

**AI screening bias is real, well-evidenced, and points at the name.** The load-bearing source is
**Wilson & Caliskan (UW), AAAI/ACM AIES, presented 22 October 2024** — three top-performing text-embedding
models, 3M+ comparisons, white-associated names preferred **85%** of the time, female-associated **11%**.
This is peer-reviewed and traceable. In the window, one commenter names it as the live mechanism:
*"the bias is coming from the AI systems some companies are using for filtering now… a lot don't even know
or realise that HR is doing this"* (u/Foxy_Traine, 6 upvotes, 2026-08-05).

---

## Debunks — three claims that do not survive checking

**1. 🚨 `SGD 50,000 per violation` is wrong, and the error travelled into this project.**
ADR-0007's Context records the driver as *"Singapore's Workplace Fairness Act, ~end-2027, SGD 50,000 per
violation."* The ADR already withdrew the *deadline* framing. **The figure itself also needs correcting.**
S$50,000 is the **maximum civil penalty a court may order for a *first* order against a corporate employer**
(rising to S$250,000 for subsequent orders); for an individual employer it is S$10,000 first, S$50,000
otherwise. It attaches to **systemic or severe contraventions** — the examples given are **retaliatory and
discriminatory dismissals** — and the stated enforcement posture is **education-first**, with penalties
reserved for egregious cases. **It is not per violation, it is not per application, and it is not triggered
by a date of birth appearing on a CV.** Nothing about the number ever pointed at our user; it does not point
at an employer's form either.

**2. 🚨 "Blind recruitment works" is contradicted by Australia's own randomised trial — and this matters
because it is the argument most likely to be used to justify widening the strip-list.**
The Australian Government's Behavioural Economics Team (BETA, in PM&C) ran
[*Going blind to see more clearly*](https://www.pmc.gov.au/beta/projects/unconscious-bias-australian-public-service-shortlisting-processes):
**2,100+ public servants across 15 agencies**, randomly assigned standard or de-identified applications.
Result: **de-identification did not promote diversity.** Reviewers were already discriminating *in favour of*
female and minority candidates; removing the signal made women **less** likely to be shortlisted, with
Indigenous women worst affected. The commonly-cited counter-examples (Deloitte's "blind audition", Victoria's
*Recruit Smarter*) are real but **older and non-randomised**. **Stripping a signal is not the same as
removing a bias, and the best-designed trial in one of our four markets found it ran backwards.** ⚠️ This is
not an argument against ADR-0007 — the ADR's case for stripping is **CV quality**, not bias correction — but
it removes a justification the build might otherwise reach for.

**3. "Names, photos and graduation years are the strongest proxies for race, gender and age" has a weak
source, even though the underlying claim is well-supported elsewhere.**
The sentence circulates from [Pin's blog](https://www.pin.com/blog/ai-resume-screening-bias-study/)
(published **26 May 2026**), framed as the conclusion of an audit of **37,000+ sourcing searches over 33,000+
jobs**. **That audit measured something else** — which *filters* recruiters apply (employer prestige, tenure
minimums, years-of-experience floors: *"96% of all minimum-tenure filters are set at exactly 12 months"*).
The proxy sentence is an **assertion in the piece, not a result of its audit**, no statistical methodology or
confidence intervals are disclosed, and **Pin is a vendor using the audit to position its own product**.
**Cite Wilson & Caliskan for the claim; do not cite Pin.**

---

## What each platform yielded

| Platform | Yield | Notes |
|---|---|---|
| **Reddit** | **The only live human evidence, and it is one thread.** ~130 posts pulled across 10 subreddits | Reddit's live surfaces are **403/blocked** from this environment (both the engine's own fetch and WebFetch). The **arctic-shift** archive API is the unlock again, and it rate-limits hard: **7 of my 26 queries failed** (HTTP 429 or 422), including r/VietNam × `job`, r/singapore × `job application`, and both r/AusFinance queries on the first pass. ⚠️ **Scores are captured at ingest and are floors, not final** — the r/resumes name thread lists as `1pt/1cmt` while carrying 40+ comments and a 70-upvote top reply. |
| **Web (native search)** | **Everything on the statutory and convention side** | The only lane that worked for three of four markets. **The Vietnamese-language lane is the single highest-value search I ran** and it would not have surfaced in English at all. |
| **Hacker News** | **Nothing on topic. Third consecutive research leg to find this.** | 57 stories pulled across two passes; the engine's own relevance scorer demoted **every one** as `entity-miss`. What surfaced instead: Android-to-Linux, EU age-verification apps, Google Play age signals — `age` as a keyword collision, not our topic. |
| **GitHub** | **Nothing, plus one self-reference to guard against** | 2-3 items per pass, none relevant. ⚠️ **The engine surfaced this repo's own [issue #144](https://github.com/adrien-mounier/jobcrush-app/issues/144) as ranked "evidence"** — our own ADR-0007 grilling thread, quoting our own clauses back at us. **That is not external corroboration and must never be read as any.** |
| **Polymarket** | Zero relevant markets | Expected. The one "match" was *the highest temperature in Hong Kong*. |
| **X / Twitter** | **Not searched** | No credentials (`bird_authenticated: false`, no `XAI_API_KEY`, Windows + no Firefox cookies). **Same gap as both prior legs.** Likely the largest missing vein for recruiter voice. |
| **YouTube / TikTok / Instagram** | **Not searched** | `yt-dlp` absent, no ScrapeCreators key. Career-advice video is genuinely large in Vietnam and Singapore; **this is a real gap for the convention half.** |
| **Country subreddits as a targeting strategy** | **Failed — record this** | First engine pass targeted r/singapore, r/HongKong, r/VietNam, r/australia and returned rooftop photography, Cities: Skylines and a bookstore arrest. The relevance floor dropped **177, 224, 74 and 106** off-topic posts across the four subqueries. **Country subs are about the country, not about working in it.** r/auscorp — an occupational sub — produced the only usable thread. |

**The prior legs' platform finding replicates a third time**, with one correction: for this question
**neither** code nor social is the vein. **The regulator's own site and the domestic-language advice corpus
are** — and one of those is only reachable by searching in the local language.

---

## What this means for the four pages (not decisions — inputs)

Handing the build ticket a shape, per #151's *"drafted to a shape a build ticket can lift verbatim"*:

- **The four pages are close to identical on six of the seven, and Vietnam's difference is the photograph** —
  which the renderer cannot print. **ADR-0007's Consequences section predicted exactly this and it holds.**
  The honest statement is that **the per-market machinery buys close to nothing today**, and the artifact's
  value rests on the vocabulary work and on being ready for a fifth market.
- **Date of birth is the one name where all four markets, both layers, and every source type agree**: strip.
  It is also the only one of the seven that Singapore's regulator names for an application form.
- **The photograph splits 2-2 at the recruiter layer** (Vietnam and Hong Kong expect or tolerate it;
  Australia is unanimously against; Singapore's sources contradict themselves) **and is inert for us in all
  four.** Record it; do not let it drive the design — the ticket already said this and the evidence confirms it.
- **Next-check dates should not be uniform.** Singapore's derives from a named commencement (**end-2027**,
  plus the **~2030** small-employer phase). Hong Kong's has no named date at all — its guidance last moved in
  **2016** — so its next check is a calendar choice, and the page should say that plainly rather than invent a
  trigger. Vietnam's should be **shorter than the others**, because finding 1 shows its convention is moving
  now with no scheduled event to anchor to.
- ⚠️ **The one thing the pages must not claim** is that they make a CV non-discriminatory. Findings 2 and 5
  say the opposite, and the employer-side vendors agree.

---

## Sources

**Primary — regulators and government, verified 2026-08-06**

- [TAFEP — *Fair Recruitment Practices for Employers in Singapore: Preparing for the Workplace Fairness Act*](https://www.tal.sg/tafep/resources/articles/2026/fair-recruitment-practices-for-employers-in-singapore---preparing-for-the-workplace-fairness-act) — **published 18 May 2026**; NRIC + date of birth omitted until offer; WFA "expected to take effect by the end of 2027"
- [TAFEP — Tripartite Guidelines on Fair Employment Practices](https://www.tal.sg/tafep/getting-started/fair/tripartite-guidelines) and [Guide to Writing Fair Job Posts](https://www.tal.sg/tafep/employment-practices/recruitment/writing-job-advertisements)
- [PCPD — Code of Practice on Human Resource Management (PDF)](https://www.pcpd.org.hk/english/data_privacy_law/code_of_practices/files/PCPD_HR_Booklet_Eng_AW07_Web.pdf) — in force 1 April 2001, **revised April 2016**; HKID not collected until offer accepted; 2-year retention limit
- [PCPD — Compliance Guide for Employers and HR (PDF)](https://www.pcpd.org.hk/english/data_privacy_law/code_of_practices/files/Compliance_Guide_for_Employer_Eng.pdf) · [CLIC — Privacy in Recruitment](https://www.clic.org.hk/en/topics/personalDataPrivacy/in_recruit_hr_and_work)
- [Hong Kong EOC](https://www.eoc.org.hk/en) — four discrimination Ordinances; employer recruitment training · [GovHK — Discrimination in the Workplace](https://www.gov.hk/en/residents/employment/labour/discrimination.htm)
- [Australian Government BETA / PM&C — *Going blind to see more clearly*](https://www.pmc.gov.au/beta/projects/unconscious-bias-australian-public-service-shortlisting-processes) — 2,100+ participants, 15 agencies; **de-identification did not promote diversity**
- [Australian Human Rights Commission — Age Discrimination Act](https://humanrights.gov.au/our-work/age-discrimination/about-age-discrimination-act) · [Fair Work Ombudsman — Protection from discrimination at work](https://www.fairwork.gov.au/employment-conditions/protections-at-work/protection-from-discrimination-at-work)

**Primary — peer-reviewed**

- **Wilson, K. & Caliskan, A.**, *Gender, Race, and Intersectional Bias in Resume Screening via Language Model Retrieval*, **AAAI/ACM AIES 2024**, presented 22 Oct 2024 — [arXiv 2407.20371](https://arxiv.org/abs/2407.20371) · [OJS](https://ojs.aaai.org/index.php/AIES/article/view/31748) · [UW News](https://www.washington.edu/news/2024/10/31/ai-bias-resume-screening-race-gender/) — 3M+ comparisons; white-associated names preferred **85%**, female-associated **11%**

**Primary — Vietnamese-language career corpus (the highest-value lane this run)**

- [CareerLink.vn — *Cách Viết Thông Tin Cá Nhân Trong CV: Các Trường Cần Và Không Nên Có*](https://www.careerlink.vn/cam-nang-viec-lam/viet-cv-resume/cach-viet-thong-tin-ca-nhan-trong-cv) — **27/5/2026**. Omit: CCCD/CMND until contract, detailed date of birth, *"Dân tộc và tôn giáo: bỏ hoàn toàn"*, marital status unless the JD asks. Keep: professional photo. Cites **Bộ luật Lao động 2019, Điều 8**
- [JobsGO.vn — *Cách viết CV xin việc chuẩn và ấn tượng nhất 2026*](https://jobsgo.vn/blog/cach-viet-cv-xin-viec/) — still lists *"Ngày tháng năm sinh"* as required; photo *"ảnh rõ mặt, trang phục lịch sự"*; marital status *"thường không bắt buộc"*
- [Russin & Vecchi — Vietnam's Workplace Anti-Discrimination Rules](https://www.russinvecchi.com.vn/publication/vietnams-workplace-anti-discrimination-rules/) · [Le & Tran — Employment Discrimination](https://letranlaw.com/insights/employment-discrimination/) — grounds include marital status, religion, age; fines VND 10-20m

**Primary — Reddit, window 2026-07-07 → 2026-08-06 (via arctic-shift; scores are ingest-time floors)**

- [Photo on resume?](https://reddit.com/r/auscorp/comments/1v9o8ml/photo_on_resume/) — **r/auscorp, 2026-07-29, 0pts / 64cmt** — the run's single best item. u/Appropriate_Sun6311 (61) · u/thrr4 (53) *"Common in Asia. Not in Australia"* · u/UnhappyExperience566 (39) · u/Equal-Poet-7860 (17, HR) · u/Suitable_Pass9702 (5) *"They don't want any claims of discrimination"* · u/Dangerous-Board9471 · u/TGin-the-goldy · u/komatiitic · u/RoomMain5110 (the upvoted US error)
- [Is my Muslim sounding last name on resume limiting call backs/interviews I am getting?](https://reddit.com/r/resumes/comments/1vggwly/is_my_muslim_sounding_last_name_on_resume/) — **r/resumes, 2026-08-05** — u/bruckout (70) *"Ethnic names get less interviews. Proven"* · u/darksideoftheday (41, the accidental A/B test) · u/lancea_longini (32) · u/Foxy_Traine (AI filtering as the vector)
- [Photo on resume got me hired each time](https://reddit.com/r/resumes/comments/1verjeo/photo_on_resume_got_me_hired_each_time/) — **r/resumes, 2026-08-03, 0pts / 19cmt** — US (Midwest); replies uniformly sceptical: *"Photos identifying gender, race, and general appearance make it harder for a human to be objective"* (u/Quattro2point8L, 5) · *"Only works if you're a hunk"* · *"This is ill advised"*
- [Jobs & Recruitment Practices in HK](https://reddit.com/r/HongKong/comments/1ureehi/jobs_recruitment_practices_in_hk/) — **r/HongKong, 1pt / 4cmt — post deleted by author**; the only HK thread that looked on-topic

**Corpus counts (arctic-shift, window 2026-07-07 → 2026-08-06)**

- r/HongKong `job` **35** · r/auscorp `resume` **24**, `CV` **14** · r/askSingapore `resume` **5**, `CV` **4** · r/AusFinance `resume` **5** · r/HongKong `CV` **2** · r/VietNam `CV` **1**, `resume` **1** · r/singapore `CV` **0**, `resume` **1** (off-topic)
- Engine passes: pass 1 (country subs) 27 Reddit / 21 HN / 2 GitHub / 1 Polymarket; pass 2 (career subs) 18 Reddit / 36 HN / 3 GitHub
- **Failed queries (429/422):** r/HongKong × `resume`,`CV` (first attempt) · r/VietNam × `resume`,`CV`,`job` · r/AusFinance × `resume`,`CV` · r/singapore × `resume`,`job application`

**Low-trust (commercial / SEO / vendor — cited only to show what the visible advice corpus contains)**

- [Morgan Philips HK](https://hk.morganphilips.com/insights-hk/how-to-write-a-cv-for-hong-kong-in-2026), HoiSum Job, ResumeWriter.hk, Jobera — HK CV guides 2026, mutually inconsistent on the photograph
- airesume.guru, resumevera.com, careerbldr.com — Singapore CV guides; *"many employers still expect"* a photo, **no method disclosed**
- resume-example.com, proresumes.io, resumeflex.com, novoresume — the **English-language** description of Vietnamese CV convention that finding 1 contradicts
- [Pin](https://www.pin.com/blog/ai-resume-screening-bias-study/) — vendor blog, 26 May 2026; **audit measured recruiter filters, not proxies**; see debunk 3
- iCIMS, Pinpoint, Treegarden, iSmartRecruit — employer-side ATS redaction / de-identification features; **no dated launch in the window**
- Herbert Smith Freehills Kramer, Mayer Brown, Drew & Napier, Allen & Gledhill, DLA Piper, Clyde & Co, SingaporeLegalAdvice — WFA commencement and penalty structure (law-firm client alerts; higher trust than SEO, still secondary)

**Not searched:** X/Twitter (no credentials), YouTube/TikTok/Instagram (tooling absent).
**Searched and empty:** Hacker News (3rd consecutive leg), Polymarket, GitHub, r/HongKong on the seven, r/VietNam in English, r/singapore.
**Blocked:** Reddit live surfaces (403), topcv.vn (403 — could not read Vietnamese template field lists directly).
**Failed as a strategy:** country subreddits as a targeting mechanism; use occupational subs instead.
