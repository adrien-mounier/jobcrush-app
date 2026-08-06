# A project done for an employer — what the last 30 days actually says

Research leg for [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150) (recent-movement half;
the deep-sources half is [`work-projects-inside-a-job.md`](work-projects-inside-a-job.md)). Unblocked by
[ADR-0006](../adr/0006-a-project-is-a-container-not-a-fact.md), which decided the **personal** project and
explicitly deferred this one.

**Window:** 2026-07-07 → 2026-08-06. **Run date:** 2026-08-06.

**Deliberately excludes** standalone personal / side-project sections — that was
[#147](https://github.com/adrien-mounier/jobcrush-app/issues/147) and
[#148](https://github.com/adrien-mounier/jobcrush-app/issues/148), and their companions are in this folder.

---

## Bottom line

🚨 **This half is thin, and the reader should weight it accordingly. That is the honest headline, and it
is stated first so no later section reads stronger than the evidence behind it.**

**1. Nobody is arguing about this, and the silence is itself the finding.** Thirty days across
`r/resumes`, `r/EngineeringResumes`, `r/cscareerquestions`, `r/consulting`, `r/jobs` and `r/recruitinghell`
returned **28 threads carrying 22,763 upvotes and 3,251 comments** — and **not one** debating whether a
project done for an employer earns its own heading inside the job. Every ranked cluster the run produced
scored **zero** and was demoted as off-topic. What those communities are actually spending their energy on
is employment precarity: a rescinded-offer thread at **2,886 points** where the top reply
(**1,726 upvotes**, u/Friendly-Occasion364) is *"you may have a claim under promissory estoppel"*, and a
layoff thread where u/Major\_Bag\_8720 drew **627 upvotes** for *"I know many people who are middle aged,
lost their jobs and are now in much more junior roles paying a fraction of what they were previously
making."*

**This matches, from the other direction, what the deep half found:** the deep sources are consistent and
unexcited, the practitioner register is silent, and **a question nobody argues about is not one with a
moving answer.** It is settled convention, not a live debate — which means the deep half is the one that
settles #150, and this half should not be given equal weight in the merge.

⚠️ **Silence is not agreement, and it is not absence of the practice.** ADR-0006's consequences already
recorded the same asymmetry for the personal project — *"people in our market write projects on their CVs
and never discuss them"*. The corpus proves the practice; the discourse simply never touches it. Read this
finding as *"no movement to track"*, never as *"nobody does this"*.

**2. The nested named shape is in commercial template circulation right now.** SAP- and IT-consultant
résumé templates from VisualCV, MyPerfectResume and IgniteSAP ship a literal `Projects:` line **inside a
single work-experience entry** (e.g. *"Projects: Led successful migration project for global ERP system
implementation; Developed a custom SAP Fiori application for inventory management"*). This is not a layout
someone invented for the ticket — it is what a consultant is handed when they download a template for
their own profession. It is also, notably, **a label over a bullet list rather than a set of named
entries with their own parts** — which is exactly the correction the deep half makes to the ticket's read
of Adrien's own `Project Achievements`.

**3. The advice that does exist fires on precisely our densest CV, and only there.** Monster's guidance is
that when **one long tenure dominates**, you split the bullets into distinct projects or workstreams;
several career-service pages say sub-headings are the right tool for a multi-project role. Nothing found
recommends it as a default. The recommendation is conditional on a shape **one** of our six CVs has.

**4. 🚨 The one real cost the practitioner layer surfaces is the parser, and its prescribed fix is the
expensive version of this feature.** JobShinobi's ATS heading guide states that parsers infer subsections
from **the size of the vertical gap between lines**, not from any markup, and that **nested sub-bullets
deeper than one level disrupt parsing**. ResumeSolving makes the same point from the failure side: a
catch-all block mixing skills, awards and projects **cannot be categorised**, and the fix is to split into
standard headings. ResumeAdapter's prescription is the telling one: *if you use a Projects block, format
each entry the way you format an Experience entry* — **name | tech | date | bullets**.

**Read that against the deep half's finding 8:** a named project that survives parsing has to look like a
job. So the practitioner advice and the schema evidence converge on the same conclusion from opposite
ends — **the cheap version of this feature is not the version that works.**

⚠️ **This layer is content-marketing SEO, not primary.** All four sources are résumé-tool blogs with a
product to sell, they cite no parser vendor, and #147 already characterised this register. The claim
"parsers read whitespace, not markup" is **plausible and consistent with RChilli's behaviour** in the deep
half, but it is **not independently verified here**. Do not promote it to a fact.

**5. The confidentiality worry does not bite, and this closes the ticket's Q5.** The consensus across
Kickresume, ResumeWorded, PrepLounge, Wall Street Oasis, the Glassdoor consulting forum, Fishbowl and Blind
is uniform and has no dissent: **assume you need permission, sanitise the client to a descriptor** — *"a
leading global bank"*, *"a medium-sized commercial bank"*, *"a leading UK healthcare company"* — **and keep
the engagement.** The recurring line is that interviewers do not care about the client name, they care what
you did on the engagement.

**So a named project entry never requires a nameable client**, and the banking / consulting case #150
worried would break the design does not break it. ⚠️ **But note which way this cuts:** it removes an
objection to building; it supplies no reason to build. And it makes the deep half's finding 9 **worse, not
better** — if the convention is to write a descriptor line for the client, that descriptor is one more
name-plus-date-range sitting under an employer.

---

## What this half cannot settle

- **Q1's frequency question.** No published measurement of how often CVs nest named projects inside a job
  exists in this window, and the deep half found none either. The 7:1 ratio remains **one corpus of six
  documents**, and the deep half shows it is really one document.
- **Whether recruiters find the nested shape useful or noise.** Zero direct practitioner statements either
  way. The templates prove supply; nothing found measures reception.
- **The ATS claim.** See finding 4 — plausible, consistent, unverified, and sourced entirely from a
  commercial layer with an incentive to make formatting sound perilous.

## Run conditions, recorded so the thinness is attributable

- **Sources active:** Reddit (28 threads), Hacker News (9 stories), GitHub (13 items), Web.
- **Sources unavailable:** X/Twitter (needs Firefox cookies or an API key; only Firefox is supported on
  Windows) and YouTube (needs `yt-dlp` installed). Neither is likely to move a CV-formatting question, but
  the gap is named rather than hidden.
- **Reddit dedicated lane** pulled **72 posts** from `r/resumes` and `r/EngineeringResumes`; the relevance
  floor dropped essentially all of them. Those subreddits' 30-day window is *roast-my-résumé* submissions
  and layoff threads, not format design.
- **Raw run artifact:** `~/Documents/Last30Days/listing-projects-under-each-job-on-a-resume-raw-v3.md`,
  with the web supplements appended.

## Sources

**Practitioner / commercial layer (secondary — treat as convention, not evidence)**

- JobShinobi — ATS-optimised section headings that parse.
  https://www.jobshinobi.com/blog/ats-optimized-resume-section-headings-that-parse
- ResumeAdapter — ATS résumé format 2026 (layout rules that parse).
  https://www.resumeadapter.com/blog/ats-resume-format-2026
- ResumeSolving — "ATS reality: what the parser breaks". https://resumesolving.com/ats-resume-format/
- Monster — how to list projects on résumés.
  https://www.monster.com/career-advice/resume/how-to-list-projects-on-resume
- BeamJobs — consulting résumé examples. https://www.beamjobs.com/resumes/consulting-resume-examples
- Hacking the Case Interview — consulting résumé guide.
  https://www.hackingthecaseinterview.com/pages/consulting-resume-guide

**Shipped templates using a `Projects:` line inside a role**

- VisualCV — SAP consultant. https://www.visualcv.com/resume-samples/sap-consultant/
- MyPerfectResume — SAP Basis consultant.
  https://www.myperfectresume.com/resume/examples/data-systems-administration/sap-basis-consultant
- IgniteSAP — writing an SAP-focused résumé. https://ignitesap.com/writing-an-sap-focused-resume-that-gets-noticed/

**Confidential-client convention (uniform, no dissent)**

- Kickresume. https://www.kickresume.com/en/blog/resume-vs-non-disclosure-agreement/
- ResumeWorded. https://resumeworded.com/blog/resume-nda/
- PrepLounge. https://www.preplounge.com/consulting-forum/resume-help-client-confidentiality-16503
- Wall Street Oasis. https://www.wallstreetoasis.com/forum/resume/client-names-on-resume
- Glassdoor consulting forum.
  https://www.glassdoor.ca/Community/consulting/can-you-put-client-names-on-ur-resume-none-of-my-clients-had-me-sign-a-nda

**The window's actual top threads, cited as evidence of what the register is about**

- r/jobs — rescinded offer, 2,886 pts / 391 cmt.
  https://www.reddit.com/r/jobs/comments/1vg7vtl/accepted_a_job_put_in_my_two_weeks_and_they/
- r/jobs — laid off at 56, 2,236 pts / 296 cmt.
  https://www.reddit.com/r/jobs/comments/1v2pdrs/laid_off_at_56_landed_a_job_after_one_year_with_a/
- r/recruitinghell — résumé roast, 8,899 pts / 400 cmt.
  https://www.reddit.com/r/recruitinghell/comments/1vdrn4v/any_tips_on_how_to_improve_my_resume_censored_for/
