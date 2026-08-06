# What belongs on each market's strip-list, and when it must next be checked

_Deep-sources half of the research for [#151](https://github.com/adrien-mounier/jobcrush-app/issues/151),
under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127). Serves
[ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) clause 2 (the country page) and
clause 11 (its next-check date). Written 2026-08-06; every source accessed that day._

_A `/last30days` companion covers recent movement. This half covers statutes read from the register,
regulator-issued codes read from the issuing body, tripartite and government guidelines, and the
established recruitment-industry references for each market._

**The four markets, and only four.** Our posting provider covers **Hong Kong, Singapore, Vietnam,
Australia** — zero UK, zero EU
([`live-posting-retrieval-contract.md`](live-posting-retrieval-contract.md)). Nothing here researches a
market we do not serve.

---

## 🚨 Read this before the country pages: the framing that must not slip

**Every obligation in this document binds an employer. None binds our user.**

Nothing found in any of the four markets makes it unlawful for a candidate to write a date of birth, an
age, a marital status, a race, a religion or a gender on their own CV. In Singapore the position is
explicit and was already recorded in ADR-0007's Context: the rules point at the employer's process. A
country page — or any UI copy derived from it — that says *"illegal to include"* would tell our user
something **false about the law**.

The two things a page may truthfully say are:

- **what a compliant employer's process must do** with the fact (statutory or regulator-issued, dated,
  sourced); and
- **what recruiters in that market conventionally expect** to see on a CV (sampled, softer, drifting).

These are separated in every table below and they carry different confidence and different refresh
cadence. **They are not the same finding and must never be merged into one column.**

---

## Bottom line

**1. 🚨 Three of the four pages are identical, and the fourth differs in two cells. The per-market
machinery buys almost nothing today.** Singapore, Hong Kong and Australia strip **all seven**, on
independent legal bases that happen to converge. Vietnam strips **five** and keeps **two** — date of
birth and gender. Of the seven names, **one (photograph) cannot print at all** because the renderer has
no image slot (ADR-0007 clause 6 Context). So the entire observable value of four country pages, today,
is **two cells on one market**. The owner should know this before anyone prices the build.

**2. Vietnam is the expected divergence, but not for the expected reason, and it is stronger than
convention.** The brief anticipated photo, date of birth and marital status as *conventional* there. The
photo and date of birth hold up; **marital status is weaker than expected** and I would strip it. What
was *not* anticipated is that Vietnam's divergence is **statutory, not merely conventional**: Labour
Code 2019 **Article 16(2)** expressly obliges an employee to give the employer *"full name, **date of
birth, gender**, residence, educational level, occupational skills and qualifications, health
conditions"* on request before an employment contract is concluded. Vietnamese law contemplates the
employer asking. Singapore's guidelines tell the employer not to.

**3. The strongest single rule found anywhere is Australian and is a *state* rule, not a federal one.**
Victoria's Equal Opportunity Act 2010 **s 107** — *"Prohibition on requesting discriminatory
information"* — and Queensland's Anti-Discrimination Act 1991 **s 124** — *"Unnecessary information"* —
make it unlawful for an employer to **ask**, application form included, with the burden of proving a
non-discriminatory purpose on the asker. Federal cover is patchier than it looks: **the Racial
Discrimination Act 1975 has no requests-for-information provision at all** (verified by reading the
consolidated Act), and there is **no federal religious discrimination Act**.

**4. Hong Kong reaches the same answer as Singapore with materially weaker law behind it, and two of
the seven have no discrimination statute at all.** Hong Kong has **no age discrimination legislation**,
and the Race Discrimination Ordinance says in terms that *"The RDO does not apply to discrimination on
the ground of religion"*. Age and religion in Hong Kong rest on a **voluntary 2006 Labour Department
guideline with no legal effect** and on data-minimisation under the PCPD's Code. Same strip decision,
much thinner ground — which matters for how confidently the page's *reason* is written.

**5. The one rule in all four markets that names a photograph in an anti-discrimination instrument is
Hong Kong's**, and it is about race, not vanity: EOC Code of Practice ¶5.3.4(2) tells employers to
*"Avoid requests for photographs and copies of ID cards at the application stage as this may be
perceived as an indication of an intention to discriminate on the ground of race"*. Singapore's TGFEP
names it too. **No Australian statute names a photograph** — it is caught only as a proxy. Recorded, and
per the brief it drives nothing.

**6. The next-check dates are genuinely uneven, and only one of the four derives from a named
commencement.** Singapore's Workplace Fairness Act 2025 *"comes into operation on a date that the
Minister appoints by notification in the Gazette"* — announced for **end-2027**, so **2027-06-30**.
Vietnam's Personal Data Protection Law commenced **2026-01-01** and its implementing detail is pending,
so **2026-12-31** — the earliest of the four. Hong Kong and Australia have **no dated commencement
pending**; their dates are calendar dates with named early triggers, and this document says so rather
than dressing them up.

**7. The knowledge base's value is probably not the strip-list.** Four pages, one divergence, two cells,
one of them unrenderable. ADR-0007's own Consequences already predicted this. The appendix records what
landed in my lap on per-market CV *convention* — it is out of scope for clause 2 and is the likeliest
reason the artifact is worth its cost.

---

## The seven at a glance

Strip = the country page removes it. Keep = the page leaves it alone (ADR-0007 clause 2: everything not
on the list prints).

| | **Singapore** | **Hong Kong** | **Australia** | **Vietnam** |
|---|---|---|---|---|
| **date of birth** | 🔴 strip | 🔴 strip | 🔴 strip | 🟢 **keep** |
| **age** | 🔴 strip | 🔴 strip | 🔴 strip | 🟠 strip *(contested)* |
| **marital status** | 🔴 strip | 🔴 strip | 🔴 strip | 🟠 strip *(contested)* |
| **photograph** | 🔴 strip | 🔴 strip | 🔴 strip | 🟠 strip *(inert — no image slot)* |
| **race** | 🔴 strip | 🔴 strip | 🔴 strip | 🔴 strip |
| **religion** | 🔴 strip | 🔴 strip | 🔴 strip | 🔴 strip |
| **gender** | 🔴 strip | 🔴 strip | 🔴 strip | 🟢 **keep** |

🔴 well-founded · 🟠 contested, reasoning stated on the page · 🟢 keep

**Read the identical columns honestly.** Singapore, Hong Kong and Australia agree on the *answer* while
disagreeing sharply on the *authority*: Singapore's rests on tripartite guidelines plus an Act that has
not commenced; Hong Kong's on a statutory code for race and a **voluntary** guideline for age; Australia's
on state "don't ask" provisions with a patchy federal layer. A page records the reason, not just the
verdict, so the three pages are not copies of each other even though the seven verdicts match.

---

# Singapore

## 1. What the employer's process must do

**Statutory — not yet in force.**

The **Workplace Fairness Act 2025 (No. 8 of 2025)**, read from the Acts Supplement, fixes eleven
protected characteristics at **s 8**:

> *"8. The protected characteristics are — (a) age; (b) nationality; (c) sex; (d) marital status;
> (e) pregnancy; (f) caregiving responsibilities; (g) race; (h) religion; (i) language ability;
> (j) disability; and (k) mental health condition."*

Two provisions matter for a CV:

- **s 19(1)** makes it discrimination for an employer to publish an advertisement or description
  *"that mentions (expressly or by implication) a protected characteristic as a condition, criterion,
  requirement, advantage, disadvantage or disqualification for employment"*.
- **s 5(2)(b)(ii)** — the one that reaches the application itself — makes *"asking for information or
  documents from the individual for the purposes of possible employment"* a **step towards an offer**,
  and therefore part of an *employment decision* governed by the Act.

⚠️ **The Act contains no provision about application forms and no list of fields to remove.** Verified by
searching the enacted text: *"date of birth"* and *"application form"* appear **zero** times, and the
Act's single use of *"photograph"* is an enforcement officer's power to photograph premises under s 36 —
nothing to do with recruitment. The field-level rule is entirely the tripartite guidelines' work, below.
**A page that cites the Act for *"remove the photograph"* is citing the wrong instrument.**

**Regulator-issued and in force now.** The **Tripartite Guidelines on Fair Employment Practices**
(TAFEP), *Job Applications → Job Application Forms*:

> *"In brief, examples of information that are not relevant to ask in the application form would be age,
> date of birth, gender, race, religion, marital status and family responsibilities including whether an
> applicant is pregnant or has children, and disability."*
>
> *"As NRIC details can be telling of age, if there are identification needs, employers should accept as
> an alternative and provide the 'NRIC/Passport Number' option in the form."*
>
> *"Employers should not request for other personal details, for example photograph and national service
> liability, as these generally should not be considerations in assessing an applicant's suitability.
> This personal information can be obtained at point of job offer."*

TAFEP's live guidance repeats it as an instruction: *"Remove fields on age, gender, race, religion,
marital status and family responsibilities, or disability"* and *"Remove fields on photographs or
national service liability."*

**This is the cleanest, most explicit source in the whole study.** It names six of the seven by name and
the seventh (age) twice over.

## 2. What recruiters conventionally expect

Convergent with the guidelines and unusually well-settled. **Robert Walters Singapore**, the market's
established professional-recruitment reference: *"Your date of birth should never be included. This
gives the recruitment consultant, and your potential employer, a rough idea of your age — information
they don't need when reviewing applicants,"* and age and marital status likewise excluded. NRIC in
particular is treated as never belonging on a résumé because it encodes the date of birth.

⚠️ **Confidence note.** The general Singapore-CV pages returned by search are overwhelmingly SEO and
AI-generated content that cite each other and TAFEP second-hand; they are not cited here. The convention
finding rests on TAFEP's own instruction to employers plus one established recruiter, which is thinner
than it looks — but it points the same way as the guidelines, so nothing turns on it.

## 3. The page

| | Strip / keep | Reason | Source |
|---|---|---|---|
| **date of birth** | 🔴 **strip** | Named explicitly in the tripartite guidelines' list of information not relevant to ask; also the reason NRIC is discouraged | TGFEP, *Job Application Forms*; TAFEP live guidance |
| **age** | 🔴 **strip** | Named in TGFEP; protected characteristic WFA s 8(a) | TGFEP; WFA 2025 s 8(a) |
| **marital status** | 🔴 **strip** | Named in TGFEP; protected characteristic WFA s 8(d) | TGFEP; WFA 2025 s 8(d) |
| **photograph** | 🔴 **strip** | Named explicitly — *"Employers should not request for other personal details, for example photograph"*; obtainable at point of job offer only | TGFEP, *Job Application Forms*; TAFEP live guidance |
| **race** | 🔴 **strip** | Named in TGFEP; protected characteristic WFA s 8(g); *"multiracialism is a fundamental principle in Singapore"* | TGFEP; WFA 2025 s 8(g) |
| **religion** | 🔴 **strip** | Named in TGFEP; protected characteristic WFA s 8(h) | TGFEP; WFA 2025 s 8(h) |
| **gender** | 🔴 **strip** | Named in TGFEP as "gender"; protected characteristic WFA s 8(c) as "sex" | TGFEP; WFA 2025 s 8(c) |

## 4. Next check: **2027-06-30**

**Derived from a named commencement.** WFA 2025 **s 1**: *"This Act is the Workplace Fairness Act 2025
and comes into operation on a date that the Minister appoints by notification in the Gazette."* No date
is in the Act. The announced timetable is **end-2027** for employers with 25 or more employees, with
smaller employers (5–24) following in a later phase reported as around 2030. The
**Workplace Fairness (Dispute Resolution) Bill** passed Parliament on **2025-11-04**.

**Early triggers that should pull the check forward:**

- the **commencement notification appearing in the Gazette** (the Act's own trigger — this is the event,
  not the calendar);
- TAFEP **reissuing or superseding the TGFEP** ahead of commencement, which is where the field-level
  rule actually lives;
- the second phase for 5–24-employee firms acquiring a date.

⚠️ **What commencement will and will not change for us.** Every one of the seven is *already* on
Singapore's strip-list via the guidelines. Commencement changes the **enforceability** of the employer's
obligation, not the **content** of our page. If a build ticket is waiting for end-2027, it is waiting for
nothing.

---

# Hong Kong

## 1. What the employer's process must do

**Statutory, and narrower than the seven.** Hong Kong has four anti-discrimination ordinances: the
**Sex Discrimination Ordinance** (sex, marital status, pregnancy, breastfeeding), the **Disability
Discrimination Ordinance**, the **Family Status Discrimination Ordinance**, and the **Race
Discrimination Ordinance** (Cap. 602).

🚨 **Two of the seven have no discrimination statute behind them in Hong Kong:**

- **Age.** *"There is currently no legislation which prohibits discrimination on the grounds of age."*
  The only instrument is a voluntary Labour Department guideline (below).
- **Religion.** The EOC's own Code says it in terms: *"Religion in itself is not race. A group of people
  defined by reference to religion is not a racial group under the RDO. **The RDO does not apply to
  discrimination on the ground of religion.**"* Nationality and length of residency are likewise outside
  the RDO's meaning of race — though the Code warns *"these matters should not be used as a mask to hide
  what is in fact race discrimination."*

**Regulator-issued and statutory in status.** The **EOC Code of Practice on Employment under the Race
Discrimination Ordinance**, issued under **RDO s 63**, is *"a statutory code that has been laid before
the Legislative Council… Although the Code is not law, it shall be admissible in evidence and the court
shall take into account relevant parts of the Code in determining any question arising from proceedings
under the RDO."* Two paragraphs are directly on point:

> **¶5.3.4(2)** *"Avoid requests for photographs and copies of ID cards at the application stage as this
> may be perceived as an indication of an intention to discriminate on the ground of race although asking
> for ID numbers would be acceptable. Requests for photographs and copies of ID card can be made at the
> interview stage for identification purposes."*
>
> **¶5.3.6(1)** *"It is recommended that questions on application forms should not suggest that the
> employer wishes to take into account any race related factors not relevant to the job which would lead
> to employment being declined on the ground of race, unless GOQ applies."*
>
> **¶5.3.6(2)** Race-related information *"should only be sought for purposes of making any special
> arrangement"* (religious festivals, dietary needs), the purpose must be stated, and *"This information
> should be detachable from the rest of the application form and should not be made known to members of
> selection panels before the interview."*

**Data-protection layer.** The PCPD's **Code of Practice on Human Resource Management**, April 2016
(First Revision), whose *"mandatory provisions… are printed in normal typeface"*. It does **not**
enumerate the seven. It imposes minimisation:

> **¶2.2.2** *"An employer should not collect personal data from job applicants unless the data is
> adequate but not excessive in relation to the purpose of recruitment,"*  with the relevant data being
> *"work experience, job skills, competencies, academic/professional qualifications, good character and
> other attributes required for the job."*
>
> **¶2.2.1**, worked example: *"an employer should not use a vacancy notice to solicit the submission of
> personal data by candidates for the purpose of unlawfully discriminating against them on grounds of
> **gender or marital status**…"*

It also bars collecting a **copy** of an HKID before an offer is accepted (¶2.2.4), while permitting the
ID *number* under four conditions (¶2.2.3).

**Voluntary, no legal effect.** The Labour Department's **Practical Guidelines for Employers on
Eliminating Age Discrimination in Employment**, January 2006:

> *"Requests for photographs should not be made until the interview stage, as otherwise this may give the
> impression of discrimination on the ground of age. **Consideration could also be given to reviewing the
> need for the item 'Date of birth' on an application form**"*

and, in its worked example, *"in the job application form, the item 'Date of Birth' was not included."*
⚠️ These guidelines *"are voluntary and non-binding… created solely for the purpose of educating the
public and employers, and have no legal effect."* **Twenty years old and the only instrument covering age
in Hong Kong.**

## 2. What recruiters conventionally expect

⚠️ **This is the weakest convention evidence in the study, and it repeats a gap
[`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) already recorded:** *"I could not find a
single high-trust primary source on HK or SG CV conventions. Every result was SEO or AI-generated careers
content."* That finding survives this round intact.

What can be said at established-recruiter level: **Robert Walters Hong Kong** lists the personal block as
name, address, telephone numbers and email — **date of birth, marital status and photograph are absent
from the recommended set**, and photographs are advised against. Beyond that, low-trust sources agree a
professional headshot and a date of birth are *more* common in Hong Kong than in Singapore, especially at
local firms, and are dropped for multinationals, banks and law firms. **I could not verify that split
against any authoritative source and it is not cited as a finding.**

One claim I chased and could not stand up: several secondary sources assert the **Labour Department
advises jobseekers against giving date of birth, HKID number, marital status, nationality or religion**.
I could not locate that guidance on `labour.gov.hk` or `jobs.gov.hk`. **Treat as unverified.**

## 3. The page

| | Strip / keep | Reason | Source |
|---|---|---|---|
| **date of birth** | 🔴 **strip** | Labour Department invites employers to review the need for the field; PCPD minimisation makes it hard to justify as job-relevant. ⚠️ **No age discrimination statute exists** — this is the thinnest ground in Hong Kong | LD *Practical Guidelines* (2006, voluntary); PCPD HRM Code ¶2.2.2 |
| **age** | 🔴 **strip** | Same, and no statute. Voluntary guideline recommends age-neutral advertising and interviewing | LD *Practical Guidelines* (2006, voluntary) |
| **marital status** | 🔴 **strip** | Discrimination ground under the SDO; named in the PCPD Code's worked example of an unlawful collection purpose | SDO; PCPD HRM Code ¶2.2.1 |
| **photograph** | 🔴 **strip** | The most explicit rule in Hong Kong — avoid requests at application stage; permitted at interview stage for identification | EOC RDO Code ¶5.3.4(2); LD *Practical Guidelines* |
| **race** | 🔴 **strip** | Application-form questions must not suggest race-related factors will be taken into account; where sought at all, must be detachable and withheld from the panel | EOC RDO Code ¶5.3.6(1)–(2), statutory code under RDO s 63 |
| **religion** | 🔴 **strip** | 🚨 **No discrimination law covers religion in employment** — *"The RDO does not apply to discrimination on the ground of religion."* Basis is PCPD minimisation alone | EOC RDO Code ¶2.2.1/3.6; PCPD HRM Code ¶2.2.2 |
| **gender** | 🔴 **strip** | Discrimination ground under the SDO; named in the PCPD Code's worked example alongside marital status | SDO; PCPD HRM Code ¶2.2.1 |

## 4. Next check: **2027-06-30** — ⚠️ **not derived from a commencement**

**Hong Kong has no dated commencement pending on any of the seven.** ADR-0007 clause 11 asks for a date
derived from named commencements rather than the calendar; for Hong Kong there is nothing to derive from,
and inventing one would be worse than saying so. The date above is a **calendar date chosen to coincide
with Singapore's**, so both APAC pages are checked in one pass.

**Named early triggers, any of which should pull the check forward:**

- **any age-discrimination bill reaching the Legislative Council.** The EOC has recommended legislating
  and its own research found 35% of employed persons reported age discrimination in five years; the
  Government has made no commitment and no date exists. This is the single change that would most alter
  Hong Kong's page — it would move two of seven rows from a voluntary 2006 guideline onto statute.
- **a revision of the PCPD Code of Practice on Human Resource Management**, last revised **April 2016**
  and now ten years old. It is the sole basis for the religion row.
- **further implementation of the EOC's Discrimination Law Review recommendations** beyond the
  Discrimination Legislation (Miscellaneous Amendments) Ordinance 2020.

---

# Australia

## 1. What the employer's process must do

**Australia is the only one of the four with a statutory prohibition on *asking*, and the strongest
versions of it are state law.**

**Victoria — Equal Opportunity Act 2010, s 107, *"Prohibition on requesting discriminatory
information"*:** a person must not request or require another to supply information that could be used to
form the basis of discrimination, and *it is irrelevant whether the request is made orally, in writing,
in an application form or otherwise*. **s 108** provides the exception where the information is
reasonably required for a non-discriminatory purpose, **and puts the burden of proof on the person who
asked**, who must also not disclose it unnecessarily and must destroy or de-identify it when no longer
required. The Act's **17 protected attributes** include age, marital status, parental or carer status,
physical features, pregnancy, **race (including colour, nationality, ethnicity and ethnic origin)**,
**religious belief or activity**, sex, gender identity and sexual orientation.

The **Victorian Equal Opportunity and Human Rights Commission's** *Guideline for the recruitment industry
and employers* (2nd edition, September 2014) states it for recruiters directly:

> *"It is also against the law for you to request information from applicants that could be used to
> discriminate against them, unless you can show that you need that information for a nondiscriminatory
> purpose. This includes verbal or written requests, interview questions, and application forms whether
> printed or online."*

and, in its positive-duty checklist: *"Examine materials such as job descriptions and application forms…
Do they request potentially discriminatory information that is not related to the genuine requirements of
the job?"* The Guideline is *"not legally binding"* but *"authoritative — a court or [VCAT] may consider
whether employers have complied with the guidelines."*

**Queensland — Anti-Discrimination Act 1991, s 124, *"Unnecessary information"*:** *"A person must not
ask another person, either orally or in writing, to supply information on which unlawful discrimination
might be based,"* with a defence where *"the information was reasonably required for a purpose that did
not involve discrimination."* QCAT has found an employer contravened s 124 by requiring job applicants to
supply such information.

**Federal, and patchier than it looks — verified by reading the consolidated Acts:**

- **Sex Discrimination Act 1984, s 27** *"Requests for information"*: unlawful *"to request or require
  another person… to provide information (whether by way of completing a form or otherwise)"* where it
  would be unlawful to discriminate on **sex, sexual orientation, gender identity, intersex status,
  marital or relationship status, pregnancy or potential pregnancy, breastfeeding or family
  responsibilities**.
- **Age Discrimination Act 2004, s 32** *"Requests for information"*: the same construction, for **age**.
- **Disability Discrimination Act 1992, s 30**: the same, for disability.
- 🚨 **Racial Discrimination Act 1975: no requests-for-information provision exists.** Confirmed by
  searching the consolidated text. **Race is the one federal attribute with no "don't ask" hook** — it is
  covered in Victoria and Queensland by s 107 / s 124, and federally only by the general prohibitions and
  the Fair Work Act.
- 🚨 **There is no federal religious discrimination Act.** The Religious Discrimination Bill was not
  passed. Religion is protected in every state and territory **except New South Wales and South
  Australia**; NSW reaches only *"ethno-religious origin"* within race.

**Fair Work Act 2009, s 351** prohibits adverse action on **race, colour, sex, sexual orientation, age,
physical or mental disability, marital status, family or carer's responsibilities, pregnancy, religion,
political opinion, national extraction or social origin** — and it reaches **prospective** employees, so
a refusal to hire is caught.

⚠️ **No Australian instrument found — federal or state — names a photograph.** A photograph on a CV is
caught only as a proxy for race, sex and age under s 107 / s 124 catch-alls. It is the weakest-founded
row on the Australian page.

## 2. What recruiters conventionally expect

The strongest convention evidence of the four markets, because Australia has a dominant job board that
publishes explicit guidance. **SEEK**:

> *"Leave out personal details such as your home address, religion, age or marital status."*
>
> *"There's no need to include personal details like your age, marital status, religion, or
> nationality… avoid adding your date of birth."* Suburb and postcode suffice for location.

SEEK also asserts to candidates that *"it's actually illegal for employers in Australia to ask you for
information like age, marital status, religion, sexual preference, or nationality."* ⚠️ **That is a
simplification** — it is accurate for age (ADA s 32), sex and marital status (SDA s 27) and broadly
accurate in Victoria and Queensland, but it overstates the position for race federally and for religion
in NSW and SA. **Do not restate SEEK's legal claim as our own.** What it is good evidence of is what the
market's biggest channel tells candidates to expect.

Australia also has a documented public-sector **de-identified shortlisting** practice — the APS trialled
removing gender, race and ethnicity from applications — though there is **no APS-wide policy** and the
largest trial found de-identification could *reduce* minority shortlisting. Recorded as context, not as a
convention we should encode.

## 3. The page

| | Strip / keep | Reason | Source |
|---|---|---|---|
| **date of birth** | 🔴 **strip** | Discloses age; asking is unlawful absent a non-discriminatory purpose. Named directly in the dominant job board's guidance | ADA 2004 s 32; EO Act 2010 (Vic) ss 107–108; AD Act 1991 (Qld) s 124; SEEK |
| **age** | 🔴 **strip** | Explicit federal requests-for-information provision; adverse action ground for prospective employees | ADA 2004 s 32; FW Act 2009 s 351; VEOHRC Guideline |
| **marital status** | 🔴 **strip** | Explicit federal requests-for-information provision; protected attribute in Vic and Qld; adverse action ground | SDA 1984 s 27; EO Act 2010 (Vic) s 6; FW Act 2009 s 351 |
| **photograph** | 🔴 **strip** | ⚠️ **No statute names it.** Caught as a proxy for race, sex and age under the state "don't ask" provisions; convention is unambiguous | EO Act 2010 (Vic) s 107; AD Act 1991 (Qld) s 124; SEEK |
| **race** | 🔴 **strip** | 🚨 **No federal requests-for-information provision exists** (RDA 1975 verified). Covered by state "don't ask" provisions and by adverse-action law | EO Act 2010 (Vic) ss 6, 107; AD Act 1991 (Qld) s 124; FW Act 2009 s 351 |
| **religion** | 🔴 **strip** | ⚠️ **No federal religious discrimination Act.** Protected in all jurisdictions **except NSW and SA**; adverse-action ground federally | FW Act 2009 s 351; EO Act 2010 (Vic) s 6; AD Act 1991 (Qld); SEEK |
| **gender** | 🔴 **strip** | Explicit federal requests-for-information provision covering sex, gender identity and intersex status | SDA 1984 s 27; FW Act 2009 s 351; EO Act 2010 (Vic) s 6 |

## 4. Next check: **2027-06-30** — ⚠️ **not derived from a commencement**

**Australia has one live reform with no date and nothing else pending on the seven.** As with Hong Kong,
there is no commencement to derive from, and the date above is a calendar date aligned with the others.

**Named early triggers:**

- 🚨 **Queensland's Respect at Work and Other Matters Amendment Act 2024 commencing.** It was passed
  **2024-09-10**, was to apply from **2025-07-01**, and on **2025-04-30** was **indefinitely paused with
  no future commencement date announced**. It would add six protected attributes (including *physical
  appearance*) and a positive duty. **A proclamation fixing a date is the trigger.** Until then the
  Anti-Discrimination Act 1991 stands unamended, and s 124 as quoted above is current.
- **any federal religious discrimination legislation**, which would move the religion row off the
  patchwork and onto statute.
- **NSW or SA legislating religion** as a standalone attribute, which would close the two-jurisdiction
  gap named above.
- AHRC *Free and Equal* reform proposals reaching a bill.

---

# Vietnam

## 1. What the employer's process must do

**This is the one market where the statute cuts the other way, and the text is unambiguous.**

**Labour Code 2019 (Law No. 45/2019/QH14)**, read from the ILO NATLEX English text:

> **Article 3(8)** — *"'labour discrimination' means discrimination on the grounds of race, skin colour,
> nationality, ethnicity, gender, age, pregnancy, marital status, religion, opinion, disability, family
> responsibility, HIV infection, establishment of or participation in trade union… in a manner that
> affects the equality of opportunity of employment."*
>
> **Article 8(1)** — *"Forbidden actions: 1. Labour discrimination."*
>
> **Article 136(1)** — the employer must *"Ensure gender equality and implementation of measures to
> promote gender equality in **recruitment**, job assignment, training, working hours and rest periods,
> salaries and other policies."*

🚨 **And then Article 16(2), which has no analogue in the other three markets:**

> *"The employee shall provide the employer with truthful information about his/her **full name, date of
> birth, gender, residence, educational level, occupational skills and qualifications, health
> conditions** and other issues directly related to the conclusion of the employment contract **which are
> requested by the employer**."*

**Read what that list contains and what it does not.** It contains **date of birth** and **gender**. It
does **not** contain marital status, race or ethnicity, religion, or a photograph. Vietnamese law
therefore *expressly contemplates* an employer asking for two of the seven, and is silent-to-hostile on
the other five.

⚠️ **Scope limit, stated plainly.** Article 16 governs the moment *before conclusion of an employment
contract*, not CV screening. It does not oblige a candidate to put a date of birth on a CV and it is not
an application-form rule. What it establishes is that an employer asking for these two is doing something
the Labour Code names as normal — which is precisely the opposite of Singapore's guidelines, and enough
to make the Vietnam page genuinely different.

⚠️ **An internal tension worth naming:** **age** is a discrimination ground under Article 3(8) while
**date of birth** is disclosable on request under Article 16(2). Vietnamese law protects the inference
while mandating the input. I found no guidance reconciling the two.

**Penalties.** Decree 12/2022/ND-CP imposes administrative fines on discriminatory acts in recruitment
and labour management, reported in the range **VND 5,000,000–20,000,000** depending on the violation,
with failure to ensure gender equality in recruitment at **VND 5,000,000–10,000,000**. ⚠️ Figures are
from secondary legal commentary; **I did not read Decree 12/2022 in the original** and the exact article
numbers are not established here.

**New and directly relevant — the Personal Data Protection Law.** The **PDPL** was passed
**2025-06-26** and came into force **2026-01-01**, replacing the Decree 13/2023 regime. It classifies
data on **racial or ethnic origin** and **religious or political views** as **sensitive personal data**,
requiring consent that is explicit, purpose-specific, and **written or electronically authenticated**,
with implied consent, pre-ticked boxes and silence expressly prohibited. It is reported to address
recruitment and employment as a specific processing context, with the principle that employers should
process only data necessary for recruitment.

**This is the strongest legal argument for stripping race and religion in Vietnam**, and it is a
data-protection argument, not a discrimination one. ⚠️ Sourced from law-firm and IAPP commentary; **I did
not read the PDPL's article text directly** — no authoritative English text was reachable.

## 2. What recruiters conventionally expect

**Two conventions coexist in Vietnam and they contradict each other. Which one applies depends on the
channel, not on the country.**

**(a) The domestic Vietnamese-language convention keeps these details.** Vietnam's two dominant career
platforms, **TopCV** and **VietnamWorks**, tell candidates that for a domestic employer *date of birth,
gender and marital status may be included*, and that a **photograph is optional but adds appeal**. The
personal-information block is conventionally name, date of birth, address, phone, email.

**Primary evidence, and the sharpest artefact found in this study:** the Vietnamese standard
**Sơ yếu lý lịch** ("personal history statement") — here the state form **Mẫu M.01/LS**, read from a
Vietnamese consulate's own PDF — requires:

- **three photographs, 2 × 2 inches**, taken within one year, white background, one pasted into a printed
  frame on the form;
- **item 2** — date of birth, and **Nam ☐ Nữ ☐** (male / female);
- **item 5** — **Dân tộc** (ethnicity) **: Tôn giáo** (religion);
- item 4 — *nguyên quán* (place of origin).

🚨 **Do not mistake this for a CV.** The *sơ yếu lý lịch* is a separate administrative document for the
personnel file, distinct from a modern CV — Vietnamese guidance draws the line explicitly, noting marital
status is *"an essential element in sơ yếu lý lịch but not necessarily required in a CV."* Its existence
explains why these fields feel normal in Vietnam; it is **not** evidence that a CV must carry them, and a
build ticket must not conflate the two.

**(b) The international / English-language convention strips them, and Vietnamese sources say so
themselves.** Vietnamese career guidance is consistent that for foreign or international employers a
candidate should not include a photo, date of birth, gender, marital status, religion or ethnicity, on
the reasoning that photos are read as a bias risk in Europe and the US. **Robert Walters Vietnam** —
international recruiter, operating in-market — gives the same guidance as its Singapore office: **do not
include age or marital status**, because it is not relevant to job performance and could lead to
discrimination.

⭐ **This is the finding that most affects our product.** JobCrush renders an **English-language,
ATS-aware CV** against an advert sourced from an aggregator. That is channel (b), and channel (b)'s own
Vietnamese-authored guidance says strip. The Vietnamese divergence is real, but our output sits on the
side of it that mostly agrees with the other three markets.

## 3. The page

| | Strip / keep | Reason | Source |
|---|---|---|---|
| **date of birth** | 🟢 **KEEP** | 🚨 **Named in statute as information the employer may request** — Article 16(2). Conventional in a domestic Vietnamese CV. Nothing requires its removal | Labour Code 2019 art 16(2); TopCV / VietnamWorks; *sơ yếu lý lịch* form |
| **age** | 🟠 **strip** *(contested)* | Discrimination ground under art 3(8) and no instrument invites an employer to ask for age as such. ⚠️ **In tension with keeping date of birth**, which discloses it — resolve deliberately, not by accident | Labour Code 2019 arts 3(8), 8(1); Decree 12/2022 |
| **marital status** | 🟠 **strip** *(contested)* | Discrimination ground under art 3(8); **absent from art 16(2)'s disclosure list**; international recruiters in-market advise against. ⚠️ Domestic convention and the state form both keep it — **weaker divergence than the brief expected** | Labour Code 2019 art 3(8); Robert Walters Vietnam; *contra:* TopCV, *sơ yếu lý lịch* |
| **photograph** | 🟠 **strip** *(inert)* | ⚠️ **Cannot print either way** — the renderer has no image slot. Conventional and sometimes expected domestically (the state form requires three); dropped for international applications | ADR-0007 clause 6 Context; *sơ yếu lý lịch* form M.01/LS; TopCV |
| **race** | 🔴 **strip** | Discrimination ground under art 3(8); **absent from art 16(2)**; **sensitive personal data under the PDPL** requiring explicit written consent | Labour Code 2019 art 3(8); PDPL 2025 |
| **religion** | 🔴 **strip** | Discrimination ground under art 3(8); **absent from art 16(2)**; **sensitive personal data under the PDPL**. ⚠️ Present on the state administrative form — do not read that as CV convention | Labour Code 2019 art 3(8); PDPL 2025 |
| **gender** | 🟢 **KEEP** | 🚨 **Named in statute as information the employer may request** — Article 16(2) — while art 136(1) simultaneously requires gender equality *in recruitment*. Conventional domestically | Labour Code 2019 arts 16(2), 136(1); TopCV / VietnamWorks |

🚨 **The Vietnam page is the only one where a build ticket must not lift the table without the owner
reading §2 above.** Two rows are keeps that our product's own output channel argues against, and three
more are marked contested. The page is defensible as written; it is not obvious.

## 4. Next check: **2026-12-31** — the earliest of the four

**Derived from a named commencement that has already happened.** The **PDPL came into force
2026-01-01**; a year of implementing detail and enforcement practice should exist by the date above, and
the race and religion rows rest on it.

**Named early triggers:**

- **the PDPL's implementing decree(s)**, particularly anything addressing recruitment as a processing
  context or the consent mechanics for sensitive data — this is the single item most likely to firm up or
  overturn two rows;
- the **Employment Law 2025** (passed 2025-06-16, in force **2026-01-01**) acquiring recruitment-conduct
  content. ⚠️ On the reading done here it is **almost entirely about unemployment insurance, job
  counselling and training support** and adds nothing to the seven — but it is new and worth one look;
- any amendment touching **Labour Code art 16(2)**, which is the whole basis for the two keeps.

---

## What I could not establish, and why

**1. Vietnam's PDPL article text.** No authoritative English text of the Personal Data Protection Law was
reachable; the sensitive-data classification and the consent mechanics are taken from law-firm and IAPP
commentary. **The race and religion rows on Vietnam's page rest on a secondary reading of a primary
instrument.** If those rows matter to a build, get the Vietnamese text.

**2. Decree 12/2022's exact penalty articles.** The VND 5–20 million range and the gender-equality-in-
recruitment figure come from legal commentary; the decree itself was not read.

**3. Whether Hong Kong's Labour Department publishes jobseeker-facing guidance against giving date of
birth, HKID, marital status, nationality or religion.** Asserted by several secondary sources; not
locatable on `labour.gov.hk` or `jobs.gov.hk`. **Unverified.**

**4. The current version number of the TGFEP.** The text quoted above is read verbatim from a PDF
**reprinted February 2017**; TAFEP's own publication index lists the guidelines under **2019**, and
TAFEP's live pages (accessed 2026-08-06) state the same field-level rules including photographs. The
substance is confirmed on both; **the version label is not.** A build ticket citing "TGFEP" should cite
the live TAFEP page, not a year.

**5. High-trust CV-convention sources for Hong Kong and Singapore.** Same void
[`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) recorded in its Q7. Every general
CV-convention result for both markets was SEO or AI-generated. The convention findings for those two rest
on **one established recruiter each plus the regulator's own instruction to employers** — thinner than the
statutory findings and marked as such.

**6. Whether any Vietnamese employer actually rejects a CV for omitting a photo or a date of birth.** No
evidence either way. The convention sources say these are *conventional*, and one says a photo is
requested where appearance is a genuine requirement. **Nothing establishes a penalty for omission.**

**7. Whether our posting provider's Vietnam coverage skews to English-language adverts.** This is the
fact that decides whether Vietnam's page should follow channel (a) or channel (b), and it is a question
about *our own data*, answerable without any further research. **Answer it before building the Vietnam
page.**

---

## ⚠️ Two things this research found that ADR-0007 did not anticipate

**1. "Gender" and "sex" are not the same word in these instruments, and one market's list uses each.**
Singapore's WFA s 8(c) says **sex**; the TGFEP says **gender**; Australia's SDA separates **sex**,
**gender identity** and **intersex status** as three attributes; Vietnam's art 16(2) says **gender** and
its standard form offers **Nam / Nữ** only. Clause 2's vocabulary has one name where the sources have up
to three. This does not change any verdict above — every instrument strips or keeps all of them together
— but a build ticket that models `gender` as a two-value field will be modelling the state form, not the
law.

**2. Nationality is on every market's radar and is not one of the seven.** It is a protected
characteristic under Singapore's WFA s 8(b), a discrimination ground under Vietnam's art 3(8), an
adverse-action ground under Australia's FW Act s 351 (*national extraction*), and expressly **outside**
Hong Kong's RDO. ADR-0007 clause 7 already treats nationality separately and correctly — it is the one of
the eight facts that an advert can genuinely test, and the `work-rights` dimension already says the useful
thing without it. **No change proposed. Recorded so that a future reader does not think it was
overlooked.**

---

## 📎 Appendix — out of scope for the strip-list, noted because it landed in my lap

🚨 **ADR-0007 clause 2 forbids a market style guide, and none of this belongs on a country page.** It is
recorded because ADR-0007's own Consequences predicted that regional *vocabulary and convention*, not the
strip-list, would be the knowledge base's first genuinely valuable content. Nothing below was hunted for.

- **Vietnam runs two document types, not one.** The **sơ yếu lý lịch** (state-form personal history
  statement: photo, date of birth, sex, ethnicity, religion, place of origin) and the **CV** are distinct
  documents with distinct conventions, and Vietnamese guidance draws the line explicitly. Any future
  Vietnam work that treats "the Vietnamese CV" as one thing will get it wrong.
- **Australia has an address-granularity convention with a named rule:** *suburb and postcode* only — no
  street address. This is the most specific, best-sourced convention finding in the study and it concerns
  a field **not among the seven**.
- **A "Personal Details" block is a live section in Vietnam and a vestigial one elsewhere.** Vietnamese
  templates have a named personal-information block; Singaporean and Australian guidance treats personal
  details as a shrinking header. Hong Kong sits between, unverified.
- **Identity-number handling is a real per-market rule and is not one of the seven.** Singapore: offer
  *NRIC/Passport Number* because NRIC discloses age, and defer to point of offer. Hong Kong: the ID
  **number** is collectable under four PCPD conditions, a **copy** of the card is not until an offer is
  accepted. Vietnam: the citizen identity card number is a required field in the employer's statutory
  labour-management book under Decree 145/2020. **Three markets, three different rules, none of them on
  clause 2's list.**
- **The regional-vocabulary finding already in our research is untouched by this round** — *"programme
  manager"* and *"delivery manager"* near-absent in Hong Kong and Singapore where *"project manager"*
  dominates. Nothing here contradicts it and nothing here extends it.

---

## Sources, with liveness

**Statutes and subsidiary legislation — read from the register or an official text**

- **Workplace Fairness Act 2025 (No. 8 of 2025), Singapore** — protected characteristics s 8;
  discriminatory advertisement s 19; hiring s 5(2)(b)(ii); commencement s 1 (by Ministerial notification,
  **not yet gazetted**). Announced for **end-2027**, 25+ employees first.
  https://assets.egazette.gov.sg/2025/Legislative%20Supplements/Acts%20Supplement/06.pdf ·
  https://sso.agc.gov.sg/Act/WFA2025
- **Labour Code 2019 (Law No. 45/2019/QH14), Vietnam** — arts 3(8), 8(1), **16(2)**, 136(1). English text
  hosted by the ILO. In force since 2021-01-01.
  https://natlex.ilo.org/dyn/natlex2/natlex2/files/download/110469/VNM110469%20Eng.pdf
- **Sex Discrimination Act 1984 (Cth)** — **s 27 Requests for information**, read from the consolidated
  text. Live. https://www.legislation.gov.au/C2004A02868/latest/text
- **Age Discrimination Act 2004 (Cth)** — **s 32 Requests for information**, read from the consolidated
  text. Live. https://www.legislation.gov.au/C2004A01302/latest/text
- **Racial Discrimination Act 1975 (Cth)** — 🚨 **searched and confirmed to contain no
  requests-for-information provision.** Live. https://www.legislation.gov.au/C2004A00274/latest/text
- **Disability Discrimination Act 1992 (Cth), s 30** — requests for information, disability. Live.
- **Equal Opportunity Act 2010 (Vic)** — **s 107** *Prohibition on requesting discriminatory
  information*; **s 108** exception with burden on the asker; s 6, 17 protected attributes. Live.
  ⚠️ Section text obtained via search summary and the VEOHRC Guideline's quotation of it; AustLII is
  Cloudflare-gated and the consolidated PDF URL 404'd. **Wording confirmed twice, not read from the
  register.**
- **Anti-Discrimination Act 1991 (Qld), s 124** *Unnecessary information*, with the reasonable-requirement
  defence. **Current as at 2025-05-19** — the 2024 Respect at Work amendments are **passed but paused
  with no commencement date**. https://www.legislation.qld.gov.au/view/whole/html/inforce/current/act-1991-085
- **Fair Work Act 2009 (Cth), s 351** — adverse action on protected attributes, reaching prospective
  employees. Live.
- **Decree 145/2020/ND-CP, Vietnam** — labour-management book fields (full name, gender, date of birth,
  citizenship, ID number…). Live. ⚠️ Read via commentary, not the decree.

**Regulator-issued codes and guidelines — primary, read in full**

- **Tripartite Guidelines on Fair Employment Practices, Singapore (TAFEP)** — *Job Application Forms*,
  *Job Advertisements*, *Job Interviews*. Read verbatim from a PDF **reprinted February 2017**;
  cross-checked against TAFEP's live pages 2026-08-06. ⚠️ Version label unresolved (see gap 4).
  https://www.tal.sg/tafep/getting-started/fair/tripartite-guidelines ·
  https://www.tal.sg/tafep/employment-practices/recruitment/preparing-job-application-forms
- **EOC Code of Practice on Employment under the Race Discrimination Ordinance, Hong Kong** — ¶5.3.4(2)
  photographs and ID cards, ¶5.3.6(1)–(2) race-related information on application forms, ¶2.2/3.6 religion
  outside the RDO. **Statutory code under RDO s 63, admissible in evidence.**
  https://www.legco.gov.hk/yr08-09/english/hc/sub_leg/sc64/papers/sc64cb2-2028-1-e.pdf
- **PCPD Code of Practice on Human Resource Management, Hong Kong** — **April 2016 (First Revision)**,
  mandatory provisions in normal typeface. ¶2.2.1 unlawful collection purpose (gender, marital status),
  ¶2.2.2 adequate-but-not-excessive, ¶2.2.3–2.2.4 HKID. ⚠️ **Ten years old.**
  https://www.pcpd.org.hk/english/data_privacy_law/code_of_practices/files/PCPD_HR_Booklet_Eng_AW07_Web.pdf
- **Practical Guidelines for Employers on Eliminating Age Discrimination in Employment, Hong Kong Labour
  Department, January 2006** — photographs at interview stage only; review the need for *"Date of birth"*
  on an application form. ⚠️ **Voluntary, no legal effect, twenty years old, and Hong Kong's only
  age instrument.**
  https://www.labour.gov.hk/eng/plan/pdf/eade/Employers/PracticalGuidelines.pdf
- **VEOHRC, *Guideline for the recruitment industry and employers*** — 2nd edition, **September 2014**,
  ISBN 978-0-9871041-8-2. Authoritative but not binding; VCAT may consider compliance.
  https://www.humanrights.vic.gov.au/static/c6f0b39f9c9bf8a5b39f9bc4f34811d4/Resource-Guidelines-Recruitment.pdf

**Recruitment-industry references — convention, not law**

- **SEEK (Australia)** — *"Leave out personal details such as your home address, religion, age or marital
  status"*; suburb and postcode only. ⚠️ Its accompanying legal claim overstates the position for race and
  for religion in NSW/SA — **do not restate it**.
  https://au.seek.com/career-advice/article/what-is-a-resume ·
  https://au.seek.com/career-advice/article/resume-cv
- **Robert Walters** — same firm, four markets, used deliberately as a controlled comparison.
  **Singapore:** date of birth *"should never be included"*; age and marital status excluded.
  **Vietnam:** do not include age or marital status. **Hong Kong:** personal block is name, address,
  phone, email; photographs advised against.
  https://www.robertwalters.com.sg/insights/career-advice/e-guide/how-to-write-a-resume.html ·
  https://www.robertwalters.com.vn/insights/career-advice/e-guide/how-to-write-a-cv.html ·
  https://www.robertwalters.com.hk/insights/career-advice/e-guide/how-to-write-a-cv.html
  ⚠️ All three are bot-gated; content obtained via search-result summaries, **not read directly**.
- **TopCV and VietnamWorks (Vietnam's dominant career platforms)** — date of birth, gender and marital
  status acceptable for domestic employers; photo optional and encouraged; **strip all of them for
  foreign/English-language applications**. ⚠️ TopCV is Cloudflare-gated; content via search summaries.
  https://www.topcv.vn/cach-viet-thong-tin-ca-nhan-trong-cv · https://blog.topcv.vn/huong-dan-viet-cv-chi-tiet/

**Primary artefacts**

- **Sơ yếu lý lịch, form Mẫu M.01/LS** — Vietnamese state personal-history form, read from a Vietnamese
  consulate PDF. Three 2×2-inch photographs; date of birth + Nam/Nữ; **Dân tộc / Tôn giáo**; place of
  origin. **A personnel-file document, not a CV.**
  https://vietnamconsulate-sf.org/data/downloads/2012/soyeulylich.pdf

**Checked and not relied on**

- Every general "CV format for Hong Kong / Singapore" guide surfaced by search — SEO or AI-generated,
  mutually citing, no samples or methods. Same pollution pattern
  [`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) recorded.
- The claim that Hong Kong's Labour Department advises jobseekers to omit date of birth, HKID, marital
  status, nationality and religion — **not locatable at source**.
- Australian de-identified-shortlisting trials as a convention signal — no APS-wide policy exists, and the
  largest trial found de-identification could reduce minority shortlisting.

**Prior research this builds on (do not re-derive)**

- [`live-posting-retrieval-contract.md`](live-posting-retrieval-contract.md) — the four-market coverage
  that bounds this document.
- [`personal-projects-on-a-cv.md`](personal-projects-on-a-cv.md) — the HK/SG convention-source void, and
  the pattern that high-traffic career keywords produce polluted search space.
- [ADR-0007](../adr/0007-what-prints-is-decided-per-application.md) — clause 2 (the seven names, and the
  prohibition on a style guide), clause 3 (no page means nothing is stripped), clause 6 (the photograph
  cannot print), clause 7 (nationality is not one of the seven), clause 11 (the next-check date).
