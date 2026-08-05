# What people are actually saying about CV content and screening - last 30 days

**Research window:** 2026-07-05 to 2026-08-04 (Reddit, primary window). Hacker News extended to
2026-06-20 to catch two threads that dominate the topic. Compiled 2026-08-04.

**Purpose:** companion social-listening evidence to the source-based research on what CVs should
contain and what employers screen on. This file prioritises what is *current* and *changing* over
what is well-established.

---

## How to read this file

Every finding is tagged. The tags are load-bearing - a lot of the loudest material on this topic is
marketing copy from companies that sell resume optimisation.

| Tag | Means |
|---|---|
| **[EVIDENCE]** | A dated, attributable artefact: a named study, a court filing, a legislative date, a first-hand account with engagement numbers behind it. |
| **[CLAIM]** | Opinion or assertion. Includes recruiter opinion, candidate opinion, and vendor statistics whose methodology is not published. |
| **[CONTESTED]** | The last 30 days contain a live, unresolved disagreement. |
| **[CONTRADICTS GUIDANCE]** | Recent sentiment cuts against established/official/vendor advice. These are the most useful lines in this document. |

### Coverage and its limits - read before citing anything here

**Searched:** Reddit (38,936 posts pulled across 27 subreddits via the Arctic Shift archive, filtered
to 825 topic-relevant threads), Hacker News (855 stories/comments via Algolia), GitHub, Polymarket
(zero relevant markets), and general web.

**NOT searched directly:** X/Twitter (no auth configured on this machine), YouTube, TikTok,
Instagram (no tooling/key). LinkedIn is not machine-searchable at all. Everything below attributed
to X, LinkedIn or YouTube came in *through web search*, i.e. second-hand. Treat those as weaker than
the Reddit and HN material, which is first-hand with engagement numbers.

**Reddit score caveat:** archive scores are snapshots taken near post time. High scores (hundreds to
thousands) are mature and reliable. Any post shown below with a low score but a high comment count
(e.g. `0pts / 40cmt`) has an *understated* score - trust the comment count as the engagement signal
there. Comment-level scores in the archive appear mature and are reliable. Live Reddit verification
was attempted and blocked (HTTP 403), so scores could not be re-checked on 2026-08-04.

---

## 1. What is changing right now in CV screening

### 1.1 The single loudest artefact of the window: an ATS that scores the same CV differently every run

**[EVIDENCE]** *"HackerRank open sourced its ATS. My resume scored 90/100. Oh wait 74. No - 88"* -
Hacker News, **2026-06-29, 1,032 points, 433 comments**
(https://news.ycombinator.com/item?id=48713832). The author ran one unchanged CV through HackerRank's
open-sourced LLM-based applicant tracking system repeatedly and got materially different scores each
time. Quoted in-thread: **"I fail 65% of the time. Same exact resume, different luck."**

This is the highest-engagement item in the entire corpus and it is about **non-determinism in
LLM-based CV scoring**. That is new. Prior ATS complaints were about keyword matching; this one is
about the same document being ranked differently on identical input.

**[EVIDENCE]** The rubric itself became the story. Top comment, u/dc3k: *"35 points for open source
contributions / 30 for personal projects... My 15 years of work experience is worth a maximum of 25%,
so any company using this idiotic system would pass on me immediately. Open source and personal
projects are fine, but in no sane world are they worth 65% of a resume's score."*

**[EVIDENCE]** The most-cited defence of screening in the thread came from someone who runs hiring
pipelines, u/jerrythegerbil: *"35% chance of elevating a technical individual to the next stage with
no effort? I've seen as many as 100+ applicants an hour even when including a domain specific
screener question... The current reality is <1% and the person reviewing you is exhausted."*

The counter, u/kyralis: *"Gates that reduce resume flow-through are only useful if their reduction is
correlated with quality. Otherwise they're just dragging out your hiring process or unnecessarily
causing you to ultimately lower your hiring bars."*

**Why this matters for us:** the debate has moved from "does my CV contain the right keywords" to
"is the scoring itself reliable at all". Product implication: any promise that we can make a CV
"score well" is now being publicly falsified by people who ran the experiment.

### 1.2 The double bind: AI screeners prefer AI-written CVs, humans reject them

**[EVIDENCE]** The cleanest statement of the current trap, from r/jobhunting **2026-07-30**
(*"Why your AI polished resume stopped working, based on 30 threads where recruiters vent"*, 81
comments), u/clippydotjs, 9 points:

> *"I'm really curious how many of the recruiters complaining are using AI filtering tools, because
> it's been proven that LLMs have a measurable and substantial preference for LLM-written resumes.
> So, if you're not using AI to write your resume, you're getting penalized by the screening system,
> but if you do, the recruiter who looks through the recommended pile just throws it out. There's no
> winning."*

Cites arXiv:2509.00462.

**[EVIDENCE]** A builder of scoring systems said the same thing from the other side, in r/recruiting
**2026-07-09**, u/VrajaKd:

> *"A single number like that mostly measures how well a resume is optimized against the job text,
> and AI-written resumes are optimized for precisely that. So the top of the score distribution
> fills up with the most heavily templated applications, while real candidates, who describe what
> they actually did in their own words, land mid-scale."*

**[EVIDENCE]** Recruiters independently arrived at the same workaround. r/recruiting **2026-07-09**,
u/TopStockJock: *"It's the same with DayForce too. So basically I use it to eliminate the top ranked
candidates and start looking at resumes in the 80% match range. Seems to be the sweet spot."*

**This is the most actionable finding in the file.** A perfect match score is now read by some
recruiters as a *negative* signal. Optimising a CV to the top of a match distribution can be
counter-productive.

### 1.3 The AI-slop backlash is now aimed at candidates, and it is reflexive

**[EVIDENCE]** In the r/jobhunting thread above, the top-voted responses were not about the content -
they were accusations that the *post itself* was AI-written. u/tartgod (5 pts): *"This is an AI
generated post. All of OP's responses are AI generated too. It feels as if the world isn't real
anymore."* u/Whend6796 (2 pts): *"Well, your post was clearly AI slop. The 'One honest caveat.' The
'not a statistic'. It just makes my stomach churn reading the same slop over and over."*

**[EVIDENCE]** Same pattern on the highest-scoring job-search post of the window - r/JobSearchHacks
**2026-07-21**, *"I finally landed a remote job after 9 months"* (1,332 pts, 77 cmt). u/Mass_And_Sass,
56 pts: *"These AI posts and titles are so annoying. Literally see the same style all the time: Here's
what worked and what didn't."* u/ShortRasp, 26 pts: *"This whole post sounds like AI bullshit."*

**[CLAIM, and note the irony]** r/AskUK **2026-07-06**, u/robford2112: *"I ran the resume I wrote 6
years ago through an AI detector. It was 98% certain it was written by AI. Maybe I'm not human."*
AI-detection of CVs is unreliable in both directions, and candidates know it.

**[CLAIM]** The resentment is explicitly two-sided. r/jobhunting, u/anamelesscloud1: *"The irony of
recruiters complaining about AI-assisted resumes when job announcements require AI proficiency."*
And u/ryuke007: *"they use ai on you, you use ai back, and nobody learns anything about anybody."*

**[CLAIM - vendor stats, methodology unpublished]** Widely repeated figures circulating in July 2026
web content: 62% of employers reject AI-generated resumes lacking personalisation (Resume Now); 49%
of US hiring managers automatically dismiss résumés they identify as AI-generated; 74% of hiring
managers say they can spot an AI application; 80% of hiring managers dislike AI-generated CVs. **All
of these come from resume-tool vendors or careers-content sites and none publish full methodology.**
The *direction* is corroborated by the Reddit material above; the *magnitudes* are not evidence.

**[EVIDENCE]** One employer-side survey with a named house behind it: **Robert Half, March 2026** -
67% of HR leaders say reviewing AI-generated applications has slowed their hiring, one in five report
delays of over two weeks, 84% report heavier workloads.

### 1.4 Detectable fraud clusters are a new, concrete rejection reason

**[EVIDENCE]** r/jobhunting **2026-07-30**, u/explainittothegeese: *"I saw the same thing with a
recent opening on our team. Several resumes had identical formatting including no space between the
work end date and company. They all cited experience with an internal system (impossible) and had the
same responsibilities slightly reworded and shuffled across positions."*

This is a first-hand account of a real screening heuristic being applied right now: **identical
formatting artefacts across multiple applications** as a fraud tell. Relevant to us - if a tool
produces a recognisable template fingerprint, that fingerprint can become a rejection trigger.

### 1.5 The legal ground is moving under Europe, and the date is unresolved as of today

**[EVIDENCE]** AI systems used to screen or filter job applications are **Annex III high-risk** under
the EU AI Act. CV-sorting software is the European Commission's own worked example for the category.

**[CONTESTED - and the contest is live right now]** The high-risk obligations for stand-alone Annex
III systems were due to apply from **2 August 2026** - two days before this file was written. On
**7 May 2026** the Council and Parliament reached political agreement on the Digital Omnibus, which
defers them to **2 December 2027**. As of the most recent sources checked, that agreement **had not
yet been published in the Official Journal**. If it is not formally adopted before 2 August 2026, the
original obligations apply as written.

This means: **as of 2026-08-04, whether AI CV-screening in the EU is under full high-risk obligations
is genuinely unclear.** Anyone telling you confidently either way is ahead of the evidence. Deployer
duties (an employer buying screening software is a deployer) cannot be contracted away to the vendor.

**[EVIDENCE]** The gap is visible in public argument. r/AskUK **2026-07-06** cover-letter thread,
u/blue_rizla challenging another commenter: *"Be more specific, please. There's a lot in the EU AI
Act. Please tell me what category AI recruitment tools fall in to as a system, and on what date it
became illegal to use them? Do you know the answer? Because I do."* People are asserting the AI Act
bans things it does not ban.

**[EVIDENCE]** **Mobley v. Workday** - alleging Workday's AI screening discriminated against older,
Black and disabled applicants across hundreds of employers - was authorised as a collective action by
a US federal court in early 2026. Cited unprompted by a recruiter in r/recruiting on 2026-07-09
(u/ElaraStarfield) and by u/H_Mc in r/recruitinghell on 2026-07-16. Working recruiters know about
this case.

---

## 2. What candidates report actually gets them filtered out

Ranked by strength of the first-hand account, not by how often the claim is repeated.

### 2.1 Two-column layouts - the single most specific, most repeated parsing failure

**[EVIDENCE]** r/JobSearchHacks **2026-07-21** (1,332 pts thread), u/WiredOtaku, 20 pts:

> *"What nobody talks about is whether their resume even gets parsed properly by ATS. I was tailoring
> like crazy and getting nothing until I realized half the systems couldn't read my two-column
> layout. Fixed that and suddenly got calls even with generic submissions."*

Reply, u/sickswonnyne, 12 pts: *"Don't use 2 column resume templates PERIOD. Use Word and submit it as
a PDF."*

**[CLAIM - vendor-side, but consistent]** Web guidance across multiple 2026 ATS-testing articles
converges on the same list of parse-breakers: multi-column layouts (serialised left-to-right, so
content interleaves), tables used for layout, contact details inside headers/footers, non-standard
section headings ("My Journey" instead of "Work Experience"), icons, skill bars and rating dots. This
is well-established rather than new, but 2.1 above is the one with a first-hand before/after behind
it.

### 2.2 Exact-string keyword matching still exists and still auto-rejects

**[EVIDENCE]** r/recruiting **2026-07-09**, u/Mathie1729:

> *"as a candidate I once got auto-rejected by a Workday system because I didn't have 'Spark' on my
> resume, even though I wrote 'distributed computing' and had the experience. Turns out the AI score
> was just a CTRL+F for keywords. Now I just keyword-stuff my resume for every application. The whole
> thing's a joke."*

**[EVIDENCE]** r/recruitinghell **2026-07-16**, u/rac3r5, 10 pts - a government internal application:
*"The role asked for MS Word, MS Excel, MS Power Point. I just put down MS Office. I got a rejection
letter saying I didn't have MS Word, MS Office and MS Power Point."*

**[EVIDENCE]** r/resumes **2026-07-27**, u/belledamesans-merci (20 pts) asked whether matchers really
deduct for `handled` vs `handling`. A professional resume writer (u/FinalDraftResumes, 17 pts)
answered: *"Yes, some older ATS can only identify keywords on an exact match basis."*

**Product implication:** morphological variants and synonyms are still a real failure mode in *older*
systems, running alongside the newer semantic ones. Both exist in the market simultaneously.

### 2.3 Silent submission failures - the rejection that never was

**[EVIDENCE]** r/jobs **2026-07-12**, u/Shape_Weird, on why applications vanish:

> *"some job forms have a step after you press submit. the page emails you a code and then quietly
> waits for you to type it back into the form. if you closed the tab, or the email went to
> promotions, or you just did not scroll back up, nothing was sent. no error. no warning... you find
> out three weeks later when nobody replies, and by then you have already decided the problem was
> you."*

Worth flagging because it is a rejection cause that is *not* about CV content at all, and candidates
systematically misattribute it to their CV.

### 2.4 Age signals

**[EVIDENCE/CLAIM boundary is important here.]** r/recruitinghell **2026-07-16**, *"If This Story Is
True, ATS Might Be Worse Than We Thought"* (**736 pts, 48 cmt**) - a viral claim that a company's ATS
was configured to auto-reject everyone. **The thread's own top-voted comments demolished it.**
u/MilwaukeeLevel (56 pts): *"not only is that article two years old, the only thing it references is a
Reddit post that's since been deleted. It's always been bullshit."* u/_Zso (22 pts): *"Don't know how
people keep getting suckered into believing this, along with all the other complete BS ATS stories."*

But the same thread carried first-hand behaviour change. u/Aye-Chiguire (8 pts): *"I have begun
shortening my experience, avoiding listing dates for college, and that has actually been paying off."*
And u/DCGreatDane (46 pts): *"I'm 49 and anyone that is past 40 are experienced but not considered."*

**[EVIDENCE]** r/recruitinghell **2026-07-08**, *"Asking for your GPA with over 20 plus years of work
experience???"* (71 pts, 42 cmt). u/moodygradstudent, 22 pts: *"That's pretty much what it is; same
with asking for SAT or ACT scores. It's unlikely someone years out of school is likely to have that
information readily available."* Corroborating HN thread *"Job application asked for my SAT scores"*,
**2026-06-22, 162 pts, 388 comments**.

So: **the specific conspiracy (hard-coded age cutoffs) is not evidenced and is actively debunked by
the community itself; the general behaviour (candidates stripping graduation dates and old roles) is
real and widespread.** Do not conflate the two.

---

## 3. Which CV sections people argue about

### 3.1 Cover letters - genuinely, actively contested, no consensus

The clearest live disagreement in the corpus. Two threads, two markets, opposite conclusions.

**Singapore - r/askSingapore, 2026-07-30, *"What's the point of cover letters nowadays??"* (128 pts,
57 cmt).** Top comment (**128 pts**, u/xminxxx, self-identified HR):

> *"as a HR i screen through 20-30 resumes on some days, i don't even bother reading the cover letter
> tbh because when you have high volume of applications you won't have time. If you will send it via
> email directly to me as the email body, then yes I will read it. Otherwise via job application
> websites i only download the resume. Therefore, spend more time on your actual resume especially
> your accomplishments."*

Second comment (**124 pts**, u/Vanerxore): *"There is no point. I leave that section blank. If it's a
mandatory field I upload my resume instead."*

Counter in the same thread, u/shizukesa92 (17 pts), a scoring scheme worth stealing:
`-2 for a poorly written one / 0 if no cover letter / +1 for an AI generated one / +2 for a
thoughtfully written one / +3 for an interesting one`. And u/marsd (5 pts): *"-10 tbh for AI wasting
my time to read an AI gen letter that took maybe 5 sec to prompt."*

**UK - r/AskUK, 2026-07-06, *"Cover letters. Is anyone even reading them?"* (119 comments).** Opposite
top answer, u/Martinonfire (30 pts):

> *"If you are applying for a job that is likely to have many applicants then failing to follow
> instructions like 'supply a cover letter' is a very easy way for your application to be ruled out
> at the first sift without anyone even looking at your C.V."*

u/Neither_Process_7847 (3 pts), a hiring-side voice: *"If I've asked for one and they don't give one,
then it's a reject."* u/Version2dnb (5 pts): *"It's stupid because AI is filtering them anyway but
you'll be marked down for not including one."*

**Conclusion: no consensus, and the split correlates with market and with whether the letter was
explicitly requested.** The one thing both sides agree on: a generic or obviously AI-written cover
letter scores *worse than none at all*.

### 3.2 One page vs two - consensus has moved, and moved recently

**[CONTRADICTS GUIDANCE]** The "always one page" rule is being actively pushed back on by the resume
community itself. r/resumes **2026-07-22**, *"Why is a 2-page CV usually considered a bad thing?"* (40
comments; archive score understated). Top comment, u/LaFantasmita (20 pts):

> *"Two pages is fine. Just don't make it two pages if you only have one page of interesting things
> to say."*

u/FinalDraftResumes (4 pts, professional resume writer): *"There's a lot of misinformation going
around and has been for years about resume writing best practices. In reality, having a two-page CV
is, in and of itself, not a bad thing."*

**But the qualifier is consistent and strong:** length is allowed to scale with experience, not with
ambition. r/resumes **2026-07-07** (*"40 applications, 25 rejections, 0 interviews. Is it because of my
2-page CV?"*, 34 cmt): u/wandelust19 (2 pts): *"Rule of thumb is 1 page per decade of experience."*
u/remes1234 (8 pts): *"2 pages for a new grad is too much."* u/themegainferno (2 pts): *"2 pages is the
limit tho, I know I am not reading anything longer than that."*

**[EVIDENCE - APAC-specific]** Same thread, u/Sticko1897 (2 pts): *"True if you are from Asia having
one page is standard also I think in middle east too."* And u/calicali (4 pts): *"And where you live.
Some places 2 pages is standard, other places it is not."* **Region-dependence of CV length is
explicitly acknowledged by the community.**

### 3.3 "References available on request" - settled, it is dead

**[EVIDENCE]** r/resumes **2026-08-03**, thread title itself: *"References available on request is
usually dead space"* (11 pts, 3 cmt). Only substantive reply, u/DorianGraysPassport: *"Don't include
this, it's out of touch."* Low engagement, but zero dissent - this looks settled rather than
contested.

### 3.4 GPA / academic scores - contested, and field-dependent

**[EVIDENCE]** r/recruitinghell **2026-07-08** (71 pts, 42 cmt). The community view is that asking a
20-year veteran for a GPA is a proxy for age screening. But u/psychup (6 pts) drew a hard boundary:

> *"I started my career in quantitative finance. Almost every reputable firm will ask you for your GPA
> or transcript no matter how many years of experience you have. There's a lot of people on Reddit
> that like to say GPA doesn't matter, and this is mostly true. However, at the upper levels of
> finance and consulting, GPA will always matter."*

u/Highlife3270 (26 pts): *"Only experience this with super prestigious finance firms. 95% of financial
isn't like that."*

**Relevant to Hong Kong / Singapore given the banking and professional-services weighting of those
markets.**

### 3.5 Education section

**[CLAIM, disputed]** r/resumes **2026-07-27**, u/S0nG0ku88 (15 pts): *"ATS can absolutely hurt you if
you don't have the right education requirements. It used to be experience could be traded in lieu of
degree but now most companies want both."*

**[CONTRADICTS - vendor guidance says the opposite]** Web sources from July 2026 assert the reverse:
*"Over 70% of employers say they prioritize demonstrable skills over educational credentials"* and
that Google, Apple, IBM and Accenture have dropped degree requirements for most roles. **These are
vendor/careers-content assertions with no published methodology, and the practitioner voice in the
corpus contradicts them.** Skills-based hiring is much more visible in marketing copy than in
candidate experience.

### 3.6 Skills section

**[CLAIM]** No first-hand thread in the window argued about whether to *have* a skills section - it is
assumed. The live argument is about **mirroring vs stuffing**: using the posting's exact words for
skills you genuinely have (accepted) versus a 40-item everything-list (rejected). Note the tension
with 2.2 - candidates who get burned by exact-string matching rationally respond by stuffing.

### 3.7 Photos, addresses, dates of birth

**[EVIDENCE - regional, see section 6]** No meaningful Reddit debate in the window. This is settled by
region rather than by argument, so it lives in section 6.

**[CLAIM]** On addresses, the strongest specific number found: 43.4% of recruiters filter candidates
by location in the ATS (Jobscan *State of the Job Search 2025* - note the year, this is 2025 data). The
prevailing advice is city + country, never a street address.

---

## 4. Certifications - do they earn their space?

**This section confirms your finding.** Our corpus evidence (certifications on 1 of 6 real CVs, and
1 of 17 job adverts asking for one) is consistent with what practitioners say in the last 30 days,
**with one important scope limit**.

### 4.1 The headline: certifications are being publicly reframed as a trap

**[EVIDENCE]** r/ITCareerQuestions **2026-07-24**: ***"Certifications Are Becoming the New 'Just Get a
Degree' Trap"*** - **177 points, 122 comments**. The title is the thesis and it was upvoted.

Top comment, u/Freud-Network (21 pts): *"You're not competing with anyone. The person with the BSc is
getting the job with no certs long before you get it with two dozen certs."*

u/Sharpshooter188 (9 pts): *"God damn. Tf am I doing wrong? I got the trifecta ages ago and basically
got ghosted from everything I applied to."*

u/TechB84 (4 pts), an IT manager at a university who hires:

> *"Just for the fun of it, I've asked several people who completed the CompTIA 'trifecta' of A+,
> Network+, and Security+ what they were doing for work. Many of them either weren't working in IT or
> were still in very entry-level positions... One of my former student workers recently got a network
> technician job with AT&T paying $72,000 a year. He didn't have any certifications. What he did have
> was experience working in my department... relevant experience, internships, and strong references
> can carry more weight than collecting certifications."*

And the sharpest framing of the mechanism, u/Aaod (4 pts):

> *"When jobs were tough to fill, and you couldn't find an experienced worker, it was a signal to an
> employer that you were trainable if you held a certification. The problem always is and always will
> be the, once there are more credentials than demand for it, it will stop being a strong signal. It
> starts becoming the minimum."*

### 4.2 The scope limit - certifications are an IT/cyber phenomenon, not a general CV phenomenon

**[EVIDENCE]** This is the most important structural finding in this section. Of the certification
threads in the window, **essentially all of them sit in r/ITCareerQuestions, r/sysadmin and
r/cybersecurity**:

| Thread | Sub | Date | Engagement |
|---|---|---|---|
| What is your job title and how many certs do you have? | r/ITCareerQuestions | 2026-07-21 | 84 pts, **271 cmt** |
| What was your first IT certification? Are they still important? | r/sysadmin | 2026-07-21 | **254 cmt** |
| Certifications Are Becoming the New "Just Get a Degree" Trap | r/ITCareerQuestions | 2026-07-24 | 177 pts, 122 cmt |
| The VA is paying for my IT degree, asked me to list certs | r/sysadmin | 2026-07-25 | 128 pts, 88 cmt |
| What certifications do you have, and which ones actually helped? | r/sysadmin | 2026-07-14 | 69 cmt |
| free certifications | r/cybersecurity | 2026-07-05 | 122 pts, 55 cmt |
| Certifications that are worth it | r/cybersecurity | 2026-07-13 | 73 pts, 33 cmt |
| should I bother getting my CompTIA certs if I have a degree | r/ITCareerQuestions | 2026-07-23 | 52 cmt |
| Those experienced in IT - what certs have you found valuable? | r/ITCareerQuestions | 2026-07-27 | 49 pts, 36 cmt |
| Do coursera certifications even help? | r/JobSearchHacks | 2026-07-06 | 52 pts, 34 cmt |

**There is no equivalent volume in r/resumes, r/jobs, r/recruiting, r/humanresources, r/careerguidance
or any regional sub.** In general-purpose CV discussion, certifications barely came up in 30 days.

**Conclusion: your 1-of-6 and 1-of-17 finding is confirmed, and the mechanism is now clear.**
Certifications are a high-salience, high-anxiety topic inside IT/security/cloud, and near-invisible
outside it. A CV product that treats "Certifications" as a standard first-class section is
over-fitting to one vertical.

### 4.3 Where certifications still demonstrably pay

**[EVIDENCE]** Even within IT, the community distinguishes sharply. u/AdeelAutomates (7 pts):
*"Every week I beat the drum here to ditch the CompTIA crap and hop on the vendor certs... You have
real networking certs like CCNA. Real Microsoft certs for Azure, M365. Real DevOps certs like
Terraform, CKA for kubernetes. Real Linux certs like RHCSA."*

u/OfxThexAges (2 pts): *"CCNA with no experience. Got me in the field and got me a pathway to 6 figures
real early in life."* u/sssRealm (2 pts): *"Got A+ cert 25 years ago. Helped me get my first entry
level tech job. Certificates are mostly useless, but may help you get an entry level job."*

**[EVIDENCE]** And the counter-evidence to "certs are worthless" is real: u/InvokerLeir (2 pts) - CCNP,
CISSP, 28 YOE, $200K+ - *"In my experience, you should have both technical certification and academic
degree."* Meanwhile u/soleedus (2 pts): *"SRE. No certs or degree. $140k base."*

**Synthesis: certifications function as an entry-level door-opener in IT and as a compliance
requirement in specific regulated niches (security clearance, some cyber roles). They do not function
as a differentiator at senior level, and they are close to irrelevant outside technology.**

**[CONTRADICTS GUIDANCE]** Web/SEO content from July 2026 uniformly says certifications are valuable
and tells you where to place them on the page. That content is produced by resume-builder companies.
The practitioner voice in the same window is markedly more sceptical. Weight accordingly.

---

## 5. Form length and abandonment

### 5.1 The named villain is Workday, and the complaint is re-entry, not length per se

**[EVIDENCE]** r/recruitinghell **2026-07-07**, *"Workday makes you create a new login for each company
and repeat the same thing over and over again"* - **345 points, 55 comments**. Top comment
(u/hawkeye_e, 176 pts): *"The most useless platform ever made."*

The abandonment statement, u/InterestingAd757 (**78 pts**):

> *"I have stopped applying to jobs that use workday, because it is tiring filling same form
> everytime, only to be rejected by a bot."*

The full mechanism, u/Jerry_From_Queens (6 pts):

> *"I don't apply to anything on Workday anymore. I'm sure it's cost me opportunities, but I don't
> care. It is such a disrespectful user experience that I won't waste my time. **Upload your resume,
> spend ages fixing the incorrect parsing, then recreate the same information on 37 subsequent
> fields.** All to be auto rejected within a week by the ATS."*

**That quote is the single most product-relevant line in this entire file.** It names the exact
failure loop: *upload → bad parse → manual repair → redundant re-entry → silent rejection.* The user
is not complaining that the form is long. They are complaining that **the form does not believe the
document they already gave it.**

**[EVIDENCE]** Corroborated in APAC. r/askSingapore **2026-07-30**, u/Every_Put6120 (7 pts): *"Even
worse are those that make you fill in a tedious employment form. Like bro, everything is already in my
CV. Why asking for the same information again?"*

**[EVIDENCE]** r/recruitinghell **2026-07-08**: *"Workday is a psychological experiment and you can't
convince me otherwise"* (215 pts, 35 cmt). r/JobSearchHacks **2026-07-18**: *"is Workday a total scam i
applied so many times on various portals but still nothing!"* (52 pts, 31 cmt).

### 5.2 The abandonment numbers - use with care

**[CLAIM - all vendor-published, methodology not disclosed, and they disagree with each other]**
Figures circulating in 2026 web content:

- 92% of candidates drop off somewhere in the process; only 8 of every 100 who click "Apply" finish.
- 61.3% abandoned mid-process; 44% cite forms exceeding 15 minutes.
- 73% abandon if the application takes longer than 15 minutes.
- 35% abandon applications that take too long; 71% expect under 30 minutes.
- "Half of all abandonment comes down to one factor: the form is too long."
- Average online job application: **45 to 60 fields**.
- Retail/hospitality: 90-95% abandonment when applications are complex. Healthcare: 52%.

**These numbers are not consistent with one another** (35% vs 61% vs 73% vs 92% for overlapping
questions), which is itself the finding: **there is no reliable public number for job-application
abandonment.** Do not build a business case on any single one of these.

**What is safe to carry forward, because the vendor stats and the first-hand accounts agree on it:**
the threshold candidates articulate is around **15 minutes**, and the trigger is **redundant re-entry
of data already supplied**, not raw field count.

**[GAP]** No usable current data was found on abandonment inside *job-seeking products* specifically
(i.e. our own onboarding, as distinct from employer ATS forms). The searches returned only ATS/apply-flow
material and generic form-template content. If we need a number for our own funnel, we will have to
measure it ourselves - it is not out there.

### 5.3 Candidates are now withdrawing from process steps on principle

**[EVIDENCE]** The second-highest-engagement Reddit post in the entire corpus: r/JobSearchHacks
**2026-07-09**, ***"I started automatically withdrawing from every one-way video interview and it is a
total game changer"*** - **3,310 points, 137 comments**.

u/Tyrilean (2 pts) gives the economic logic clearly:

> *"They're placing 100% of the labor of the hiring process on me up front without any incentive. For
> every company that required one, there were 10 that didn't, and it made more sense to maximize my
> time by applying to 10 employers than 1."*

**Implication for us: unpaid upfront effort is now something a meaningful cohort of candidates
actively refuses.** That is the environment our onboarding is competing in.

---

## 6. APAC (Hong Kong, Singapore) and France/Europe

### 6.1 Honest finding first: APAC CV discussion is almost absent from social

Of 38,936 posts pulled, r/HongKong and r/singapore produced **essentially no CV-format discussion** in
the last 30 days. The only substantive APAC thread is the r/askSingapore cover-letter one (2026-07-30,
128 pts, 57 cmt) covered in 3.1, plus scattered one-liners on CV length.

**Do not read this as "APAC candidates don't care."** Read it as: *social listening is the wrong
instrument for APAC CV norms.* Those norms come from employer guidance, regulators and market
convention, not Reddit. The source-based research is the right tool here; this file cannot
corroborate it from community chatter.

### 6.2 Hong Kong - what the current guidance says

**[CLAIM - 2026 careers-guidance content, consistent across sources]**
- **Photo:** a professional headshot is common and often expected, particularly in finance,
  hospitality and client-facing roles. Omitting one is not disqualifying.
- **Date of birth:** *not* standard on HK CVs in 2026; including it introduces age-bias risk. This
  appears to have shifted - DOB was formerly more common.
- **Nationality:** omit unless directly relevant to right-to-work.

**[EVIDENCE]** **KPMG China, Hong Kong Employment Outlook (published March 2026):** 24% of HK
organisations are widely deploying AI in 2026, **three times the 2025 figure**. 39% are in early-stage
pilots, 26% actively developing across teams. 47% now name AI understanding as a priority skill for
employees, **up from 20% a year earlier**.

**[EVIDENCE]** **ACCA Hong Kong talent trends 2026:** only **36%** of HK respondents are confident AI
algorithms support fair and unbiased recruitment; **51% are unconvinced.** Separately, 58% of ~200
organisations polled had introduced AI in their workplaces, 49% using it to optimise headcount.

**This is the most decision-relevant APAC data point:** AI in HK hiring is scaling fast (3x
year-on-year) while majority trust in its fairness is absent. Both facts matter for how we position
anything AI-driven in that market.

### 6.3 Singapore - the regulatory clock is the story

**[CLAIM - 2026 careers-guidance content]**
- **Photo:** common practice, though the Fair Consideration Framework discourages it to prevent
  discrimination. Many employers still expect one, especially client-facing. **Actively contested.**
- **Date of birth:** some local companies and government-linked entities expect it; Western MNCs
  generally do not.
- **Nationality / work-pass status:** commonly included, because foreign-hiring quotas mean it saves
  both sides time. **This is the opposite of the Hong Kong and European convention.**

**[EVIDENCE]** **Workplace Fairness Act** - passed **8 January 2025**, expected to come into force
**around end-2027**. Prohibits employment decisions based on age, nationality, sex, marital status,
pregnancy, caregiving responsibilities, race, religion, language ability, disability and mental
health condition, across **all employment stages**. Applies first to employers with **25 or more
staff**. Penalties up to **SGD 50,000 per violation**. Once in force, a job advertisement or hiring
process should not state an age preference or require a photo, age, or marital/pregnancy status
without a genuine occupational reason - *"a high bar."*

**[CONTRADICTS GUIDANCE - and this is a real product risk]** **Singapore's current CV convention
(include photo, DOB, nationality) is on a legislated collision course with the Workplace Fairness Act
from ~end-2027.** A product that helps Singaporean candidates add a photo and a date of birth today is
helping them comply with a norm that is scheduled to become legally fraught for the employer receiving
it. That gap has roughly 18 months to run.

### 6.4 France and Europe

**[EVIDENCE]** **Photo:** no French law requires one, and *"deux candidatures sur trois en France
comportent encore une photo"* - **two out of three French applications still include a photo** as of
2026. So the practice is majority-normal even though guidance increasingly advises against it.

**[CLAIM - French careers guidance, 2026]** The advice is explicitly sector-split: in tech, data,
finance and engineering roles, a photo *"peut activer des biais inconscients ou ralentir le tri par
les outils ATS"* - can activate unconscious bias or slow ATS sorting. The stated 2026 French template:
one page (two for senior cadres), simple readable columns for ATS, no photo in most sectors,
action-verb technical skills.

**[CLAIM]** *"plus de 75% des grandes entreprises"* - over 75% of large French firms use at least one
AI tool in hiring in 2026.

**[EVIDENCE - the binding legal constraint]** Under French/EU law, delegating CV sorting to an AI is
**not prohibited**, but the final decision must remain with the recruiter: the AI *"ne pourra pas
éliminer les candidatures de façon autonome mais pourra établir un classement."* It may rank; it may
not autonomously eliminate.

**[EVIDENCE]** European candidates are experimenting with name-based bias workarounds. r/AskHR
**2026-07-17**, *"Using preferred name to bypass ATS bias [EU][UK]"* (9 comments). The HR responses
were uniformly discouraging and worth quoting for how they frame the ATS:

> u/DorianGraysPassport: *"There's no such thing as bypassing the ATS, because ATSes aren't
> gatekeepers... if you're being rejected for your name, it's because people are racist. Not because
> ATSes, which are just filing cabinets, contain biases. **A filing cabinet cannot be biased.**"*

> u/CoffeeInTheTropics: *"Some HR departments in Germany and NL have implemented (hidden) nationality
> caps from certain countries due to sheer numbers from South Asian subcontinent but ATS does not
> have ethnic or gender bias built-in."*

The OP pushed back with Stanford HAI research on racial bias in AI hiring tools. **Unresolved.** Note
the distinction being drawn: bias in a *filing cabinet* (no) versus bias in an *LLM ranker* (evidenced)
- the HR professionals in that thread are arguing about the older technology while the OP is asking
about the newer one.

---

## 7. Where recent sentiment contradicts established or official guidance

This is the section to read if you read nothing else.

### 7.1 "The ATS auto-rejects your CV" - working recruiters say this is largely a myth

**[CONTRADICTS GUIDANCE]** The entire ATS-optimisation industry rests on the premise that an automated
system rejects most CVs before a human sees them. **In r/recruiting, on 2026-07-09, recruiters said
they mostly do not use the scores at all.**

Thread: *"Recruiters who use Workday: is the AI score helpful to you at all?"* (35 comments). The
answers, in vote order:

- u/mysteresc (**23 pts**): *"We never configured it, and I wouldn't use it if we did."*
- u/CranberryOk1064 (**16 pts**): *"Do not know of a company that uses it."*
- u/SqueakyTieks (**8 pts**): *"I'd really like to know what percentage of Workday's customers enabled
  it. I haven't run across any recruiters who have it. We did a demo, I hated it, and as TA Director
  told leadership no and that was the end of it."* And (6 pts): *"its skills match score sucks and I
  never look at that column either."*
- u/hartjh14 (3 pts): *"**AI is used far less in recruitment than people think.** I'm not saying nobody
  uses it, but the myth that all big companies use it is completely false."*
- u/techtchotchke (3 pts): *"tbqh I don't think I've ever encountered an automated scoring or ranking
  system that wasn't terrible."*
- u/bbawdhellyeah (11 pts) is the dissent: *"I've used the AI auto grade with iCIMs and Workable and
  they're about at 60-70% accuracy."*

**[CONTRADICTS GUIDANCE]** Corroborated from the other direction: a **2026-07-29** ClearanceJobs piece
reports that **68% of recruiters said the ATS auto-rejection myth came from job seekers repeating
viral social media posts**, and that ATS *ranks and surfaces* rather than auto-rejects.

**[CONTRADICTS GUIDANCE]** And the r/recruitinghell community debunked its own viral ATS story on
2026-07-16 (see 2.4), with 56 upvotes on *"It's always been bullshit."*

**Against that:** vendor-published statistics in the same window claim *"AI-powered ATS reject about
75% of resumes within 5 seconds"* and *"75 percent of companies allow AI to reject candidates without
human review."* **These are irreconcilable with what working recruiters said.** One of the two is
wrong, and the vendor numbers are the ones with an incentive and no methodology.

**Honest reading:** both are probably partly true and describing different segments - high-volume
retail/hospitality/graduate funnels where automation genuinely runs unsupervised, versus professional
and technical recruiting where recruiters ignore the score column. **The mistake is generalising
either one.**

**What this means for the product:** selling "we get you past the ATS" is selling into a belief that
the buyer's own recruiters publicly dispute. It also dates us - it is the 2023 framing. The 2026
framing is *volume* (u/jerrythegerbil: *"100+ applicants an hour"*) and *undifferentiability*
(u/spoink74: *"hiring teams are inundated with AI customized resumes and they can't surface
differentiated candidates"*).

### 7.2 "Optimise your CV for the match score" - now inverted

Covered in 1.2. A 100% match is being read as evidence of templating. u/TopStockJock explicitly
skips the top-ranked candidates. **Guidance that says maximise the score is now, for at least some
recruiters, advice to get yourself filtered.**

### 7.3 "Skills-based hiring has replaced the degree" - not what candidates experience

Covered in 3.5. Vendor content says 70%+ of employers prioritise skills over credentials. The
practitioner voice in r/resumes says the opposite: *"It used to be experience could be traded in lieu
of degree but now most companies want both and have the capabilities and systems to filter people
out."* And in the certifications threads, the repeated observation is *"The person with the BSc is
getting the job with no certs."*

### 7.4 "One page, always" - superseded

Covered in 3.2. The r/resumes consensus is now length-scales-with-experience, and a professional
resume writer in-thread explicitly calls the one-page rule *"misinformation... for years."*

### 7.5 "Always include a cover letter" vs "nobody reads them" - genuinely unresolved

Covered in 3.1. Neither side has won. What *has* moved: an AI-written cover letter is now scored below
no cover letter by multiple hiring-side voices.

---

## 8. What this implies for JobCrush - short version

Five things follow from the evidence above. Flagged as inference, not evidence.

1. **Do not sell ATS-beating.** It is the contested premise (7.1), it is the framing recruiters
   publicly mock, and the highest-engagement artefact of the month (1.1) is someone proving the
   scores are non-deterministic. Sell *legibility* and *truthfulness* instead - both survive the
   contradiction.

2. **A high match score is not a goal to optimise toward.** (1.2, 7.2.) If we ever surface a
   score, surface *evidence* alongside it, which is exactly what the scoring-system builder in
   r/recruiting said is missing from every ATS: *"show the evidence behind every subscore (which exact
   sentence earned it)."*

3. **Certifications should not be a first-class default section.** (Section 4.) Confirmed: they are an
   IT/cyber/cloud phenomenon. Make the section conditional on the person actually having relevant
   ones, and never prompt for them generically.

4. **The onboarding threat is redundant re-entry, not form length.** (5.1.) The quote to design
   against is *"Upload your resume, spend ages fixing the incorrect parsing, then recreate the same
   information on 37 subsequent fields."* If our parse is good and we never ask twice for something we
   already extracted, we are solving the thing people actually complain about. The articulated
   patience threshold is ~15 minutes, and we have no reliable external abandonment number to plan
   against (5.2).

5. **Regional CV fields need to be date-aware, not just region-aware.** (6.3.) Singapore's current
   photo/DOB/nationality convention has a legislated end-date of roughly end-2027. Hong Kong has
   already dropped DOB. France still has two-thirds photo adoption against guidance that says drop it.
   A single "APAC template" or "Europe template" will be wrong.

---

## Appendix A - primary Reddit sources, by engagement

Scores are archive snapshots (see caveat at top). Comment counts are reliable throughout.

| Date | Sub | Pts | Cmt | Thread |
|---|---|---|---|---|
| 2026-07-09 | r/JobSearchHacks | 3,310 | 137 | I started automatically withdrawing from every one-way video interview |
| 2026-07-21 | r/JobSearchHacks | 1,332 | 77 | I finally landed a remote job after 9 months of hunting |
| 2026-07-16 | r/recruitinghell | 736 | 48 | If This Story Is True, ATS Might Be Worse Than We Thought |
| 2026-07-08 | r/JobSearchHacks | 536 | 23 | If you use AI on your resume, do this pass before sending it |
| 2026-07-07 | r/recruitinghell | 345 | 55 | Workday makes you create a new login for each company |
| 2026-07-21 | r/jobhunting | 243 | 17 | 5 months laid off, 524 applications, 2 offers, 1 accepted |
| 2026-07-08 | r/recruitinghell | 215 | 35 | Workday is a psychological experiment |
| 2026-07-24 | r/ITCareerQuestions | 177 | 122 | Certifications Are Becoming the New "Just Get a Degree" Trap |
| 2026-07-30 | r/askSingapore | 128 | 57 | What's the point of cover letters nowadays?? |
| 2026-07-27 | r/resumes | 96 | 33 | I spoke to 32 job seekers this month - common trends |
| 2026-07-21 | r/ITCareerQuestions | 84 | 271 | What is your job title and how many certs do you have? |
| 2026-07-08 | r/recruitinghell | 71 | 42 | Asking for your GPA with over 20 plus years of work experience |
| 2026-07-06 | r/AskUK | 20 | 119 | Cover letters. Is anyone even reading them? |
| 2026-07-21 | r/sysadmin | 23 | 254 | What was your first IT certification? Are they still important? |
| 2026-07-20 | r/humanresources | 42 | 33 | Most HR professionals seem to hate video and AI interviews |
| 2026-07-30 | r/jobhunting | 42 | 81 | Why your AI polished resume stopped working |
| 2026-07-22 | r/resumes | (low) | 40 | Why is a 2-page CV usually considered a bad thing? |
| 2026-07-07 | r/resumes | 15 | 34 | 40 applications, 25 rejections, 0 interviews. Is it my 2-page CV? |
| 2026-07-12 | r/jobs | 8 | 31 | 15 years in sales, still can't get past the application form |
| 2026-07-09 | r/recruiting | 10 | 35 | Recruiters who use Workday: is the AI score helpful to you at all? |
| 2026-08-03 | r/resumes | 11 | 3 | References available on request is usually dead space |
| 2026-07-17 | r/AskHR | (low) | 9 | Using preferred name to bypass ATS bias [EU][UK] |

## Appendix B - Hacker News sources

| Date | Pts | Cmt | Thread |
|---|---|---|---|
| 2026-06-29 | 1,032 | 433 | HackerRank open sourced its ATS. My resume scored 90/100. Oh wait 74. No - 88 |
| 2026-06-22 | 162 | 388 | Job application asked for my SAT scores |
| 2026-06-23 | 154 | 160 | Algorithmic Monocultures in Hiring (arXiv 2605.27371) |
| 2026-06-21 | 113 | 210 | The early hiring funnel is now breaking on both ends |
| 2026-07-07 | 57 | 35 | Tell HN: "Who wants to be hired" posts outpace "Who's hiring" 2 to 1 |
| 2026-07-13 | 1,102 | 460 | Ask HN: Add flag for AI-generated articles (context: general AI-slop backlash) |
| 2026-07-22 | 4 | - | Why Your AI Resume Sounds Generic (and How to Fix It) |

## Appendix C - web sources consulted

- **Robert Half** (March 2026) - 67% of HR leaders say AI-generated applications slowed hiring; 84%
  report heavier workloads.
- **Enhancv** (enhancv.com, survey of 1,066 US job seekers, April 2026) - 50.5% rejected at least once
  in the past year without any human contact; only 9.7% were told AI was involved.
- **Resume Now** (resume-now.com) - 62% of employers reject AI-generated resumes lacking
  personalisation. Vendor survey.
- **ClearanceJobs** (news.clearancejobs.com, 2026-07-29) - "Recruiters Reveal ATS Doesn't Kill Your
  Resume - It's Overwhelming Volume"; 68% of recruiters attribute the auto-rejection myth to viral
  social posts.
- **KPMG China** (kpmg.com, March 2026) - Hong Kong Employment Outlook 2026; AI deployment 3x
  year-on-year.
- **ACCA** (accaglobal.com) - Hong Kong SAR talent trends 2026; 36% confident vs 51% unconvinced on AI
  recruitment fairness.
- **Mayer Brown / Fragomen / TAFEP** - Singapore Workplace Fairness Act scope, timing, penalties.
- **Gibson Dunn, DLA Piper, aiactblog.nl** - EU AI Act Digital Omnibus; Annex III high-risk deferral
  from 2026-08-02 to 2027-12-02, political agreement 2026-05-07, not yet in the Official Journal.
- **artificialintelligenceact.eu** - Annex III high-risk classification for recruitment; CV-sorting as
  the Commission's worked example. (Note: the site's public implementation-timeline page is a 2024
  snapshot and does not reflect the Omnibus deferral.)
- **Randstad France, helloworkplace.fr, pstb.fr** - French CV photo norms 2026; two-thirds of French
  applications still carry a photo; AI may rank but not autonomously eliminate.
- **Jobscan** - State of the Job Search 2025; 43.4% of recruiters filter by location in the ATS.
- **arXiv:2509.00462** - LLM rankers show measurable preference for LLM-written resumes.
- **arXiv:2605.27371** - Algorithmic Monocultures in Hiring.
- **Stanford HAI** - AI hiring tools can yield racial bias and systemic rejection.
- **Jobscan / RecruitBPM / atsverification.com / cvcraft** (2026) - ATS parsing-failure test writeups;
  columns, tables, headers/footers, icons, non-standard section names. Vendor-published.
- Multiple resume-builder blogs (aiapply, resumemate, resumestudio, hiration, tailorforge, resumefry)
  on certifications, skills sections and 2026 resume trends - **all vendor content, cited here only
  as examples of the guidance that recent practitioner sentiment contradicts.**
